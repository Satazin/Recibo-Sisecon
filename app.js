const STORAGE_KEY_EMPRESAS = 'empresasReciboSisecon';
const MAX_SUGGESTIONS = 30;

const CONFIG = {
  supabaseUrl: (window.RECIBO_CONFIG && window.RECIBO_CONFIG.supabaseUrl) || '',
  supabaseKey: (window.RECIBO_CONFIG && window.RECIBO_CONFIG.supabaseKey) || ''
};

const mesesDoAno = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const itens = [
  'IPI', 'ICMS', 'ISS', 'Imposto de Renda', 'Simples', 'INSS Empregado',
  'INSS Empregador', 'FGTS', 'PIS', 'Honorários', 'COFINS', 'Contrib. Social',
  'Livros e Autenticação', 'Registro de Firma', 'Alteração de Firma',
  'Material de Expediente', 'Carimbo', 'Contrib. Sindical', 'Outras Despesas'
];

const itensComCompetenciaMonetaria = new Set([
  'ICMS', 'ISS', 'Imposto de Renda', 'Simples', 'PIS', 'COFINS', 'Contrib. Social', 'Outras Despesas'
]);

const state = {
  empresas: [],
  remoteClient: null,
  remoteReady: false
};

function normalizeEmpresa(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' e ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildEmpresaSlug(value) {
  const base = normalizeEmpresa(value).toLowerCase();
  const words = base.split(' ').filter(Boolean);
  const ignored = new Set(['e', 'da', 'de', 'do', 'das', 'dos', 'ltda', 'sa', 's', 'empresa', 'restaurante', 'churrascaria', 'bar', 'hotel', 'pizzaria', 'mercado', 'padaria', 'cafe', 'cafeteria', 'burger']);
  const filtered = words.filter(word => !ignored.has(word));
  const selected = filtered.slice(0, 3);
  const slug = (selected.length ? selected.join('-') : words.slice(0, 3).join('-'))
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'empresa';
  return slug;
}

function loadEmpresasLocais() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_EMPRESAS);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      return parsed.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim());
    }
  } catch (error) {
    console.warn('Erro ao ler empresas locais:', error);
  }
  return [];
}

function saveEmpresasLocais(empresas) {
  const uniq = Array.from(new Set(empresas.map(v => String(v).trim()).filter(Boolean))).slice(0, 1000);
  localStorage.setItem(STORAGE_KEY_EMPRESAS, JSON.stringify(uniq));
  state.empresas = uniq;
}

function getRemoteClient() {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
    return null;
  }
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    return null;
  }
  if (!state.remoteClient) {
    state.remoteClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  }
  return state.remoteClient;
}

async function fetchEmpresasRemotas() {
  const client = getRemoteClient();
  if (!client) return [];
  try {
    const { data, error } = await client.from('empresas').select('nome').order('nome', { ascending: true }).limit(1000);
    if (error) throw error;
    return (data || []).map(row => row.nome).filter(Boolean);
  } catch (error) {
    console.warn('Supabase indisponível, usando armazenamento local:', error);
    return [];
  }
}

async function prepararEmpresas() {
  const locais = loadEmpresasLocais();
  const remotas = await fetchEmpresasRemotas();
  const merged = Array.from(new Set([...remotas, ...locais])).sort((a, b) => a.localeCompare(b));
  state.empresas = merged.slice(0, 1000);
  saveEmpresasLocais(state.empresas);
  renderSuggestions();
}

function renderSuggestions(filterText = '') {
  const datalist = document.getElementById('empresas-sugeridas');
  if (!datalist) return;

  const query = normalizeEmpresa(filterText).toLowerCase();
  const matches = [...state.empresas]
    .filter(name => !query || normalizeEmpresa(name).toLowerCase().includes(query))
    .slice(0, MAX_SUGGESTIONS);

  datalist.innerHTML = '';
  matches.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    datalist.appendChild(option);
  });
}

function adicionarEmpresaAtual() {
  const input = document.getElementById('firma');
  if (!input) return;
  const nome = input.value.trim();
  if (!nome) {
    input.focus();
    return;
  }

  const jaExiste = state.empresas.some(item => normalizeEmpresa(item).toLowerCase() === normalizeEmpresa(nome).toLowerCase());
  if (!jaExiste) {
    state.empresas.unshift(nome);
    state.empresas = Array.from(new Set(state.empresas.map(v => v.trim()).filter(Boolean))).slice(0, 1000);
    saveEmpresasLocais(state.empresas);
    if (getRemoteClient()) {
      persistirEmpresaRemota(nome).catch(() => {});
    }
  }

  renderSuggestions(input.value);
  input.focus();
  input.select();
}

async function persistirEmpresaRemota(nome) {
  const client = getRemoteClient();
  if (!client) return;
  try {
    const { error } = await client.from('empresas').upsert({ nome: nome.trim() }, { onConflict: 'nome' });
    if (error) throw error;
  } catch (error) {
    console.warn('Não foi possível salvar empresa remota:', error);
  }
}

function formatarCompetencia(valor) {
  let numeros = valor.replace(/\D/g, '').slice(0, 4);
  if (numeros.length > 2) numeros = numeros.slice(0, 2) + '/' + numeros.slice(2);
  return numeros;
}

function formatarMoeda(valor) {
  let numeros = valor.replace(/\D/g, '');
  if (!numeros) return '';
  numeros = numeros.replace(/^0+(?=\d)/, '');
  if (numeros.length === 1) numeros = '0' + numeros;
  const centavos = numeros.slice(-2);
  const inteiros = numeros.slice(0, -2) || '0';
  return inteiros.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + centavos;
}

function obterMesNumero(valor) {
  if (!valor) return null;
  const texto = String(valor).trim().toLowerCase();
  const numero = Number.parseInt(texto.replace(/\D/g, ''), 10);
  if (!Number.isNaN(numero) && numero >= 1 && numero <= 12) return numero - 1;
  const indice = mesesDoAno.findIndex(m => m.toLowerCase() === texto || m.slice(0, 3).toLowerCase() === texto);
  return indice >= 0 ? indice : null;
}

function mesPosterior(valor) {
  const indice = obterMesNumero(valor);
  if (indice === null) return '';
  const proximo = (indice + 1) % 12;
  return mesesDoAno[proximo];
}

function formatarReferente(valor) {
  let texto = valor.replace(/[^a-zA-ZÀ-ÿ0-9/ ]/g, '').replace(/\s+/g, ' ').replace(/^\s+/, '').trim();
  if (!texto) return '';

  if (texto.includes('/')) {
    const partes = texto.split('/');
    const mes = (partes[0] || '').trim();
    const ano = (partes.slice(1).join('/')).trim();
    const mesFormatado = mes ? mes.replace(/\s+/g, '').replace(/[^a-zA-ZÀ-ÿ0-9]/g, '') : '';
    const anoFormatado = ano ? ano.replace(/\D/g, '').slice(0, 4) : '';
    if (mesFormatado && !anoFormatado) return `${mesFormatado}/`;
    if (!mesFormatado && anoFormatado) return `/${anoFormatado}`;
    if (mesFormatado && anoFormatado) return `${mesFormatado}/${anoFormatado}`;
    return '/';
  }

  return texto;
}

function montarRecibo() {
  const firma = document.getElementById('firma').value || '';
  const referente = document.getElementById('referente').value || '';
  const dia = document.getElementById('dia').value || '';
  const mes = document.getElementById('mes').value || '';
  const ano = document.getElementById('ano').value || '';

  const linhasHtml = itens.map((nome, i) => {
    const comp = document.getElementById(`comp-${i}`).value || '';
    const valorRaw = document.getElementById(`valor-${i}`).value || '';
    const compTxt = comp || '';
    const compClasse = 'competencia' + (comp ? '' : ' vazio');
    const valorTxt = valorRaw || '';
    const valorClasse = 'valor' + (valorRaw ? '' : ' vazio');
    return `
      <div class="item">
        <div class="nome">${nome}</div>
        <div class="${compClasse}">${compTxt}</div>
        <div class="rs">R$</div>
        <div class="${valorClasse}">${valorTxt}</div>
      </div>`;
  }).join('');

  const totalManual = document.getElementById('totalManual').value;
  const totalTxt = totalManual || '';

  return `
    <div class="recibo">
      <div class="cabecalho">
        <div class="logo">
          <img src="data:image/png;base64,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
"; 
      </div>
      <div class="info-empresa">
        <b>FATURAMENTO</b>
        <div>Empresa: ${firma || 'A Firma'}</div>
        <div>Referente a: ${referente || 'Mês/Ano'}</div>
      </div>
    </div>

    <div class="linha-firma"><b>Recebi de:</b><span>${firma || 'A firma'}</span></div>
    <div class="linha-ref"><b>Referente a:</b><span>${referente || 'Mês/Ano'}</span></div>

    <div class="itens">${linhasHtml}</div>

    <div class="total">
      <span>${totalTxt || '0,00'}</span>
      <div>Total</div>
    </div>

    <div class="linha-data">
      <div class="data-texto">Içara – SC, <span style="width:26px; display:inline-block; text-align:center; border-bottom:1px solid var(--recibo-line);">${dia || '__'}</span> de <span style="width:110px; display:inline-block; text-align:center; border-bottom:1px solid var(--recibo-line);">${mes || 'Mês'}</span> de <span style="width:46px; display:inline-block; text-align:center; border-bottom:1px solid var(--recibo-line);">${ano || '2026'}</span></div>
      <div class="assinatura">
        <div class="linha-assinatura">Assinatura</div>
      </div>
    </div>
  `;
}

function atualizar() {
  const duasVias = document.getElementById('duasVias').checked;
  const reciboHtml = montarRecibo();
  document.getElementById('pagina').innerHTML = duasVias ? (reciboHtml + reciboHtml) : reciboHtml;
  requestAnimationFrame(ajustarPreview);
}

function ajustarPreview() {
  const folha = document.getElementById('folha');
  const paginaPreview = document.getElementById('pagina-preview');
  if (!folha || !paginaPreview) return;
  const larguraPagina = 1123;
  const larguraDisponivel = Math.max(180, folha.clientWidth - 20);
  const escala = Number(Math.min(1, Math.max(0.18, larguraDisponivel / larguraPagina)).toFixed(4));
  paginaPreview.style.transform = `scale(${escala})`;
  paginaPreview.style.transformOrigin = 'top center';
  paginaPreview.style.height = `${21 * escala}cm`;
  paginaPreview.style.width = `${29.7}cm`;
}

function imprimirRecibo() {
  window.print();
}

function obterNomeArquivoPdf() {
  const empresa = (document.getElementById('firma')?.value || '').trim();
  const slug = buildEmpresaSlug(empresa);

  let mesNumero = '';
  const referenteCampo = (document.getElementById('referente')?.value || '').trim();
  const mesCampo = (document.getElementById('mes')?.value || '').trim();

  const candidatos = [referenteCampo, mesCampo];
  for (const candidato of candidatos) {
    if (!candidato) continue;
    const texto = String(candidato).trim();

    const matchMesAno = texto.match(/(?:^|\D)(\d{1,2})\s*\/\s*(\d{2,4})?(?:\D|$)/);
    if (matchMesAno) {
      const mes = Number.parseInt(matchMesAno[1], 10);
      if (mes >= 1 && mes <= 12) {
        mesNumero = String(mes).padStart(2, '0');
        break;
      }
    }

    const matchNumero = texto.match(/(\d{1,2})/);
    if (matchNumero) {
      const mes = Number.parseInt(matchNumero[1], 10);
      if (mes >= 1 && mes <= 12) {
        mesNumero = String(mes).padStart(2, '0');
        break;
      }
    }

    const indice = mesesDoAno.findIndex(m => {
      const nome = texto.toLowerCase();
      return nome === m.toLowerCase() || nome.startsWith(m.slice(0, 3).toLowerCase()) || nome.includes(m.toLowerCase());
    });

    if (indice >= 0) {
      mesNumero = String(indice + 1).padStart(2, '0');
      break;
    }
  }

  return `recibo-${slug}${mesNumero ? `-${mesNumero}` : ''}.pdf`;
}

async function baixarPdf() {
  const alvo = document.getElementById('folha');
  if (!alvo) {
    alert('Não foi possível localizar a área do recibo para exportar.');
    return;
  }

  if (typeof html2canvas === 'undefined' || !window.jspdf || !window.jspdf.jsPDF) {
    alert('A exportação para PDF não está disponível neste momento. Tente novamente mais tarde.');
    return;
  }

  try {
    const canvas = await html2canvas(alvo, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: document.documentElement.scrollWidth,
      windowHeight: document.documentElement.scrollHeight
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const image = canvas.toDataURL('image/png');
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    pdf.addImage(image, 'PNG', 0, 0, imgWidth, imgHeight);
    pdf.save(obterNomeArquivoPdf());
  } catch (erro) {
    console.error('Erro ao gerar PDF:', erro);
    alert('Não foi possível gerar o PDF automaticamente. Use o botão de imprimir e escolha “Salvar como PDF”.');
  }
}

function limpar() {
  document.querySelectorAll('input[type="text"]').forEach(el => el.value = '');
  document.getElementById('duasVias').checked = true;
  atualizar();
}

function aplicarTema(theme) {
  const tema = theme === 'dark' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', tema);
  const btn = document.getElementById('toggleTema');
  if (btn) {
    btn.innerHTML = tema === 'dark' ? '☀' : '☾';
    btn.setAttribute('aria-label', tema === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro');
    btn.setAttribute('title', tema === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro');
  }
  requestAnimationFrame(ajustarPreview);
  localStorage.setItem('temaRecibo', tema);
}

function toggleTema() {
  const atual = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  aplicarTema(atual);
}

function montarListaItens() {
  const listaItensEl = document.getElementById('lista-itens');
  itens.forEach((nome, i) => {
    const row = document.createElement('div');
    row.className = 'linha-item';
    const placeholder = itensComCompetenciaMonetaria.has(nome) ? '0,00' : 'mm/aa';
    row.innerHTML = `
      <div class="rotulo">${nome}</div>
      <input type="text" id="comp-${i}" placeholder="${placeholder}">
      <input type="text" id="valor-${i}" placeholder="0,00">
    `;
    listaItensEl.appendChild(row);
  });

  itens.forEach((nome, i) => {
    const compInput = document.getElementById(`comp-${i}`);
    compInput.addEventListener('input', function () {
      if (itensComCompetenciaMonetaria.has(nome)) {
        this.value = formatarMoeda(this.value);
        return;
      }
      this.value = formatarCompetencia(this.value);
    });

    document.getElementById(`valor-${i}`).addEventListener('input', function () {
      this.value = formatarMoeda(this.value);
    });
  });
}

function configurarInputs() {
  document.querySelectorAll('input').forEach(el => el.addEventListener('input', atualizar));

  document.getElementById('firma').addEventListener('input', function () {
    renderSuggestions(this.value);
  });

  document.getElementById('referente').addEventListener('input', function () {
    const valor = formatarReferente(this.value);
    this.value = valor;
    const match = valor.match(/([A-Za-zÀ-ÿ0-9]+)\s*\/\s*(\d{0,4})/);
    if (match) {
      const mesValor = match[1];
      const proximo = mesPosterior(mesValor);
      const mesEl = document.getElementById('mes');
      if (proximo && mesEl) mesEl.value = proximo;
    }
  });

  document.getElementById('mes').addEventListener('input', function () {
    const valor = this.value?.trim() || '';
    if (!valor) return;
    const proximo = mesPosterior(valor);
    const referente = document.getElementById('referente');
    if (proximo && referente && !referente.value) {
      referente.value = `${valor}/`;
    }
  });

  document.getElementById('salvarEmpresa').addEventListener('click', adicionarEmpresaAtual);
  document.getElementById('firma').addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      const valor = this.value.trim();
      if (valor) {
        event.preventDefault();
        adicionarEmpresaAtual();
      }
    }
  });
}

async function init() {
  montarListaItens();
  configurarInputs();
  await prepararEmpresas();
  const temaSalvo = localStorage.getItem('temaRecibo') || 'light';
  aplicarTema(temaSalvo);
  atualizar();
  window.addEventListener('resize', ajustarPreview);
}

init();
