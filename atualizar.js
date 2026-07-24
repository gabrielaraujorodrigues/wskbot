const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ──────────────────────────────────────────────
// Cores do terminal
// ──────────────────────────────────────────────
const c = {
  reset:   '\x1b[0m',
  verde:   '\x1b[32m',
  vermelho:'\x1b[31m',
  amarelo: '\x1b[33m',
  azul:    '\x1b[36m',
  magenta: '\x1b[35m',
};
const log = (msg, cor = 'reset') => console.log(`${c[cor]}${msg}${c.reset}`);

// ──────────────────────────────────────────────
// Configurações
// ──────────────────────────────────────────────
const SITE_URL = 'https://wsksystem.com'; 

// Pastas de dados do usuário — jamais sobrescrever
const PASTAS_USUARIO = [
  'database/saves',
  'database/diversao/gold',
  'database/antiflood',
  'database/menuADM',
  'database/QRCODE',
  'node_modules',
  '.git',
  'config.json'
];

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function deveAtualizar(arquivo) {
  if (arquivo.startsWith('node_modules/')) return false;
  for (const pasta of PASTAS_USUARIO) {
    if (arquivo.startsWith(pasta)) return false;
  }
  if (arquivo.endsWith('.json')) {
    return ['package.json', 'package-lock.json'].includes(path.basename(arquivo));
  }
  return arquivo.endsWith('.js') || arquivo.endsWith('.md') || arquivo.endsWith('.txt');
}

function escrever(caminho, conteudo) {
  const dest = path.join(__dirname, caminho);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, conteudo);
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    
    client.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`Status ${res.statusCode}`));
        return;
      }
      
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function calcularHashArquivo(caminho) {
  try {
    const crypto = require('crypto');
    const data = fs.readFileSync(caminho);
    return crypto.createHash('md5').update(data).digest('hex');
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
// API do Site
// ──────────────────────────────────────────────
async function obterManifesto() {
  try {
    const url = `${SITE_URL}/bot/update/manifest`;
    const data = await downloadBuffer(url);
    return JSON.parse(data.toString());
  } catch (erro) {
    throw new Error(`Não foi possível obter manifesto: ${erro.message}`);
  }
}

/** Baixar arquivo do servidor */
async function baixarArquivo(caminhoRemoto) {
  try {
    const url = `${SITE_URL}/bot/update/download?path=${encodeURIComponent(caminhoRemoto)}`;
    const conteudo = await downloadBuffer(url);
    escrever(caminhoRemoto, conteudo);
    return true;
  } catch (erro) {
    return false;
  }
}

// ──────────────────────────────────────────────
// Atualização via Site
// ──────────────────────────────────────────────
async function atualizarViaSite() {
  log('🔄 Buscando atualizações no site...', 'amarelo');
  
  const manifesto = await obterManifesto();
  
  if (!manifesto.success) {
    throw new Error(manifesto.error || 'Erro desconhecido ao obter manifesto');
  }
  
  const arquivosServidor = manifesto.manifest;
  const versaoServidor = manifesto.version;
  
  // Verificar arquivos que precisam ser atualizados
  const arquivosParaAtualizar = [];
  const arquivosNovos = [];
  
  for (const [caminho, info] of Object.entries(arquivosServidor)) {
    if (!deveAtualizar(caminho)) continue;
    
    const caminhoLocal = path.join(__dirname, caminho);
    
    if (!fs.existsSync(caminhoLocal)) {
      arquivosNovos.push(caminho);
    } else {
      const hashLocal = calcularHashArquivo(caminhoLocal);
      if (hashLocal !== info.hash) {
        arquivosParaAtualizar.push(caminho);
      }
    }
  }
  
  if (arquivosParaAtualizar.length === 0 && arquivosNovos.length === 0) {
    log('✅ Bot já está na versão mais recente!', 'verde');
    log(`   Versão: ${new Date(versaoServidor * 1000).toLocaleString()}`, 'verde');
    return;
  }
  
  log(`⬇️  Atualizando ${arquivosParaAtualizar.length + arquivosNovos.length} arquivo(s)...`, 'amarelo');
  
  // Mostrar novos arquivos
  if (arquivosNovos.length > 0) {
    log(`\n   Novos arquivos:`, 'azul');
    arquivosNovos.forEach(f => log(`   + ${f}`, 'verde'));
  }
  
  // Mostrar arquivos modificados
  if (arquivosParaAtualizar.length > 0) {
    log(`\n   Arquivos modificados:`, 'azul');
    arquivosParaAtualizar.forEach(f => log(`   ~ ${f}`, 'amarelo'));
  }
  
  log('');
  
  let ok = 0, falha = 0;
  
  // Baixar novos arquivos
  for (const caminho of arquivosNovos) {
    if (await baixarArquivo(caminho)) {
      log(`   ✓ ${caminho} (novo)`, 'verde');
      ok++;
    } else {
      log(`   ✗ ${caminho} (erro)`, 'vermelho');
      falha++;
    }
  }
  
  // Atualizar arquivos existentes
  for (const caminho of arquivosParaAtualizar) {
    if (await baixarArquivo(caminho)) {
      log(`   ✓ ${caminho} (atualizado)`, 'verde');
      ok++;
    } else {
      log(`   ✗ ${caminho} (erro)`, 'vermelho');
      falha++;
    }
  }
  
  log('', 'reset');
  log(`✅ ${ok} arquivo(s) atualizado(s)${falha ? `, ${falha} com erro` : ''}.`, 'verde');
  log('🔁 Reinicie o bot para aplicar as mudanças.', 'azul');
}

// ──────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────
async function atualizar() {
  log('\n╔═══════════════════════════════╗', 'azul');
  log('║   WSKBOT — Atualizador v3.0   ║', 'azul');
  log('║      (Atualização via Site)   ║', 'azul');
  log('╚═══════════════════════════════╝\n', 'azul');

  try {
    // Verificar se o site está configurado
    if (SITE_URL === 'https://wsksystem.com') {}
    
    log(`🌐 Servidor: ${SITE_URL}`, 'azul');
    log('');
    
    await atualizarViaSite();

  } catch (e) {
    log(`\n❌ Erro: ${e.message}`, 'vermelho');
    log('💡 Verifique:', 'amarelo');
    log('   • Se o site está online e acessível', 'amarelo');
    log('   • Se a constante SITE_URL está configurada corretamente', 'amarelo');
    log('   • Sua conexão com a internet', 'amarelo');
    process.exit(1);
  }
}

atualizar();