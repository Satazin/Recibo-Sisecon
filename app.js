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
    .trim()
    .toLowerCase();
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
  const uniq = Array.from(new Map(
    empresas.map(v => String(v).trim()).filter(Boolean).map(v => [normalizeEmpresa(v), v])
  ).values()).slice(0, 1000);
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
  if (!client) {
    console.log('Supabase não configurado - usando apenas armazenamento local');
    return [];
  }
  try {
    console.log('Carregando empresas do Supabase...');
    const { data, error } = await client.from('empresas').select('nome').order('nome', { ascending: true }).limit(1000);
    if (error) {
      console.error('❌ Erro ao buscar empresas do Supabase:', error.message);
      return [];
    }
    const empresas = (data || []).map(row => row.nome).filter(Boolean);
    console.log(`✓ ${empresas.length} empresas carregadas do Supabase`);
    return empresas;
  } catch (error) {
    console.error('❌ Erro ao conectar Supabase:', error.message);
    return [];
  }
}

async function prepararEmpresas() {
  const locais = loadEmpresasLocais();
  const remotas = await fetchEmpresasRemotas();
  const merged = Array.from(new Set([...remotas, ...locais])).sort((a, b) => a.localeCompare(b));
  state.empresas = merged.slice(0, 1000);
  saveEmpresasLocais(state.empresas);
  // Garante que a lista fica oculta ao iniciar
  const container = document.getElementById('empresas-sugeridas');
  if (container) {
    container.innerHTML = '';
    container.setAttribute('hidden', '');
    container.style.display = 'none';
    console.log('✓ Lista de sugestões inicializada oculta');
  }
}

function renderSuggestions(filterText = '') {
  const container = document.getElementById('empresas-sugeridas');
  if (!container) return;

  // Se está vazio, não mostra nada
  if (!filterText || !filterText.trim()) {
    container.innerHTML = '';
    container.setAttribute('hidden', '');
    container.style.display = 'none';
    return;
  }

  const query = normalizeEmpresa(filterText).toLowerCase();
  const matches = [...state.empresas]
    .filter(name => !query || normalizeEmpresa(name).toLowerCase().includes(query))
    .slice(0, MAX_SUGGESTIONS);

  container.innerHTML = '';
  
  // Se não tem matches, não mostra
  if (matches.length === 0) {
    container.setAttribute('hidden', '');
    container.style.display = 'none';
    return;
  }

  matches.forEach(name => {
    const div = document.createElement('div');
    div.className = 'empresa-sugestao';
    div.textContent = name;
    div.role = 'option';
    
    div.addEventListener('click', () => {
      const input = document.getElementById('firma');
      if (input) {
        input.value = name;
        container.setAttribute('hidden', '');
        container.style.display = 'none';
        atualizar();
      }
    });
    
    container.appendChild(div);
  });

  container.removeAttribute('hidden');
  container.style.display = 'block';
}

function adicionarEmpresaAtual() {
  const input = document.getElementById('firma');
  if (!input) return;
  const nome = input.value.trim();
  if (!nome) {
    input.focus();
    return;
  }

  const jaExiste = state.empresas.some(item => normalizeEmpresa(item) === normalizeEmpresa(nome));
  if (!jaExiste) {
    state.empresas.unshift(nome);
    state.empresas = Array.from(new Map(
      state.empresas.map(v => String(v).trim()).filter(Boolean).map(v => [normalizeEmpresa(v), v])
    ).values()).slice(0, 1000);
    saveEmpresasLocais(state.empresas);
    console.log('✓ Empresa salva localmente:', nome);
    
    if (getRemoteClient()) {
      persistirEmpresaRemota(nome).then(sucesso => {
        if (sucesso) {
          console.log('✓ Empresa também salva no Supabase!');
        } else {
          console.warn('⚠️ Empresa salva localmente mas não no Supabase. Verifique a conexão.');
        }
      }).catch(err => {
        console.error('Erro ao salvar no Supabase:', err);
      });
    }
  }

  renderSuggestions(input.value);
  input.focus();
  input.select();
}

async function persistirEmpresaRemota(nome) {
  const valor = String(nome || '').trim();
  const client = getRemoteClient();
  if (!client || !valor) {
    console.warn('Supabase não disponível ou valor vazio');
    return false;
  }
  try {
    const { data, error: selectError } = await client.from('empresas').select('nome');
    if (selectError) {
      console.warn('Erro ao verificar empresas:', selectError);
      // Continua mesmo com erro na verificação
    }

    const jaExisteRemota = (data || []).some(item => normalizeEmpresa(item.nome) === normalizeEmpresa(valor));
    if (jaExisteRemota) {
      console.log('Empresa já existe no Supabase:', valor);
      return true;
    }

    const { error, data: insertData } = await client.from('empresas').insert([{ nome: valor }]).select();
    if (error) {
      if (error.code === '23505') {
        console.log('Empresa já estava salva (duplicada)');
        return true;
      }
      throw error;
    }
    
    console.log('Empresa salva no Supabase:', valor, insertData);
    return true;
  } catch (error) {
    console.error('❌ Erro ao salvar empresa no Supabase:', error.message, error);
    return false;
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
          <svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;fill:currentColor;color:var(--recibo-text);">
            <path d="M 20 40 Q 15 40 15 35 Q 15 25 25 25 Q 28 15 40 15 Q 52 15 55 25 Q 65 25 65 35 Q 65 40 60 40 Z"/>
          </svg>
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
    alert('Não foi possível gerar o PDF automaticamente. Use o botão de imprimir e escolha "Salvar como PDF".');
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

  document.getElementById('firma').addEventListener('focus', function () {
    // Só mostra sugestões se já tem texto digitado
    if (this.value.trim()) {
      renderSuggestions(this.value);
    }
  });

  document.getElementById('firma').addEventListener('keydown', function (event) {
    const container = document.getElementById('empresas-sugeridas');
    if (event.key === 'Escape') {
      container.setAttribute('hidden', '');
      container.style.display = 'none';
    } else if (event.key === 'Enter' && !event.shiftKey) {
      const valor = this.value.trim();
      if (valor) {
        event.preventDefault();
        container.setAttribute('hidden', '');
        container.style.display = 'none';
        adicionarEmpresaAtual();
      }
    }
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
    // Fecha sugestões ao clicar em outro campo
    const lista = document.getElementById('empresas-sugeridas');
    if (lista) {
      lista.setAttribute('hidden', '');
      lista.style.display = 'none';
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
    // Fecha sugestões ao clicar em outro campo
    const lista = document.getElementById('empresas-sugeridas');
    if (lista) {
      lista.setAttribute('hidden', '');
      lista.style.display = 'none';
    }
  });

  // Fechar sugestões ao clicar fora
  document.addEventListener('click', function (event) {
    const input = document.getElementById('firma');
    const lista = document.getElementById('empresas-sugeridas');
    if (!input || !lista) return;
    
    const clicouDentro = input.contains(event.target) || lista.contains(event.target);
    if (!clicouDentro) {
      lista.setAttribute('hidden', '');
      lista.style.display = 'none';
    }
  });

  // Fechar sugestões ao clicar em qualquer outro input
  document.querySelectorAll('input').forEach(el => {
    if (el.id !== 'firma') {
      el.addEventListener('focus', function () {
        const lista = document.getElementById('empresas-sugeridas');
        if (lista) {
          lista.setAttribute('hidden', '');
          lista.style.display = 'none';
        }
      });
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
