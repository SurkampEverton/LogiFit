#!/usr/bin/env node
// =============================================================================
// Nucleo do revisao-guard (o .sh e' so a saida antecipada barata).
// Recusa `gh pr create` enquanto a branch nao tem MARCA VALIDA de revisao
// adversarial (gravada por revisao-marca.mjs quando o agente
// revisor-adversarial termina com a linha `REVISADO: <branch> <sha>`).
//
// POR QUE um analisador de shell, e nao grep no texto: a 1a versao (bash+sed)
// bloqueava heredoc gravando arquivo ("proximos passos: gh pr create" no
// handoff), `echo`, comentario e `--help` — e deixava passar `gh  pr  create`,
// `gh.exe` e o escape escrito DENTRO do --body. Achados da revisao adversarial
// de 07/10/2026, todos reproduzidos e cobertos na bateria.
//
// O analisador entende: aspas simples/duplas (texto citado e' UMA palavra,
// nunca comando), heredoc (<<EOF, <<'EOF', <<-EOF: o corpo e' descartado),
// here-string do PowerShell (@' '@), comentario (#), separadores (; && || | &
// e quebra de linha), atribuicao de ambiente no comeco do comando.
//
// LIMITE declarado: shell aninhado (`bash -c '...'`, `powershell -Command
// "..."`) e' texto citado e passa. Quem segura e' a regra do CLAUDE.md.
//
// Marca valida = arquivo da branch existe, a linha `branch:` e' EXATAMENTE a
// branch (sem colisao de slug) e o `sha:` revisado esta no historico da branch
// (nome reaproveitado nao herda revisao antiga). Commit de correcao DEPOIS da
// revisao continua valendo — reverificacao e' no maximo uma, por regra.
//
// Isentas: chore/release/*, docs/*, e `ERP_SEM_REVISAO=1` como ATRIBUICAO
// (prefixo do comando, `export`, ou `$env:` no PowerShell) — nunca no texto.
//
// Falha ABERTA em erro de infraestrutura (JSON ilegivel, git indisponivel):
// sai 0. Bloqueio e' exit 2 com o motivo no stderr.
// =============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, basename } from 'node:path';
import { pastaHandoffs, slugDaBranch } from './pasta-claude.mjs';

const DIR = process.env.REVISAO_DIR || join(pastaHandoffs(), '.revisao');

// Quebra o comando em segmentos (comandos simples), cada um uma lista de
// palavras ja sem aspas. `powershell` muda o escape (crase, nao barra).
function segmentos(cmd, powershell = false) {
  const segs = [];
  let palavras = [];
  let w = '';
  let temW = false;
  const pendentes = [];
  const n = cmd.length;
  let i = 0;
  const fimPalavra = () => {
    if (temW) palavras.push(w);
    w = '';
    temW = false;
  };
  const fimSeg = () => {
    fimPalavra();
    if (palavras.length) segs.push(palavras);
    palavras = [];
  };
  const esc = powershell ? '`' : '\\';
  while (i < n) {
    const c = cmd[i];
    if (c === '\n') {
      fimSeg();
      i++;
      while (pendentes.length) {
        const { delim, tira } = pendentes.shift();
        while (i < n) {
          let j = cmd.indexOf('\n', i);
          if (j === -1) j = n;
          let linha = cmd.slice(i, j).replace(/\r$/, '');
          if (tira) linha = linha.replace(/^\t+/, '');
          i = j + 1;
          if (linha === delim) break;
        }
      }
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { fimPalavra(); i++; continue; }
    // ( ) { } e a crase do Bash abrem/fecham sub-comando: `$(gh pr create)`,
    // `(gh ...)`, `{ gh ...; }`, `if (...) { gh ... }` viram segmento proprio.
    if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '{' || c === '}' || (!powershell && c === '`')) {
      fimSeg();
      i++;
      continue;
    }
    if (c === '#' && !temW) {
      const j = cmd.indexOf('\n', i);
      i = j === -1 ? n : j;
      continue;
    }
    if (!temW && c === '@' && (cmd[i + 1] === "'" || cmd[i + 1] === '"') && /^\r?\n/.test(cmd.slice(i + 2, i + 4))) {
      const fecha = `\n${cmd[i + 1]}@`;
      const j = cmd.indexOf(fecha, i + 2);
      i = j === -1 ? n : j + fecha.length;
      w = '@here-string@';
      temW = true;
      continue;
    }
    if (c === '<' && cmd[i + 1] === '<') {
      if (cmd[i + 2] === '<') { fimPalavra(); i += 3; continue; }
      fimPalavra();
      i += 2;
      let tira = false;
      if (cmd[i] === '-') { tira = true; i++; }
      while (cmd[i] === ' ' || cmd[i] === '\t') i++;
      let delim = '';
      while (i < n && !/[\s;|&<>]/.test(cmd[i])) {
        if (cmd[i] !== "'" && cmd[i] !== '"' && cmd[i] !== '\\') delim += cmd[i];
        i++;
      }
      if (delim) pendentes.push({ delim, tira });
      continue;
    }
    if (c === esc && i + 1 < n) {
      // Continuacao de linha (`\` no Bash, crase no PowerShell, antes de LF ou
      // CRLF) some, como no shell: `... && \<LF>gh pr create` e' um comando so.
      if (cmd[i + 1] === '\n') { i += 2; continue; }
      if (cmd[i + 1] === '\r' && cmd[i + 2] === '\n') { i += 3; continue; }
      w += cmd[i + 1];
      temW = true;
      i += 2;
      continue;
    }
    if (!powershell && c === '$' && cmd[i + 1] === "'") {
      // ANSI-C do Bash ($'...'): \' NAO fecha a string.
      let j = i + 2;
      while (j < n && cmd[j] !== "'") { if (cmd[j] === '\\' && j + 1 < n) { w += cmd[j + 1]; j += 2; } else { w += cmd[j]; j++; } }
      temW = true;
      i = j + 1;
      continue;
    }
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      const fim = j === -1 ? n : j;
      w += cmd.slice(i + 1, fim);
      temW = true;
      i = fim + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      // Dentro de aspas duplas no Bash a `\` so escapa $ ` " \ e a quebra de
      // linha; antes de outra letra ela FICA ("C:\pasta\x" e' um caminho).
      // No PowerShell a crase escapa qualquer caractere.
      while (j < n && cmd[j] !== '"') {
        const prox = cmd[j + 1];
        if (cmd[j] === esc && j + 1 < n && (powershell || '$`"\\\n'.includes(prox))) {
          if (prox !== '\n') w += prox;
          j += 2;
        } else {
          w += cmd[j];
          j++;
        }
      }
      temW = true;
      i = j + 1;
      continue;
    }
    w += c;
    temW = true;
    i++;
  }
  fimSeg();
  return segs;
}

const PREFIXOS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', 'time', 'exec', 'command', 'builtin', 'nohup', 'sudo']);
// Opcoes do `gh pr create` que consomem o proximo argumento: um `--body "-h"`
// e' texto, nao pedido de ajuda.
const COM_VALOR = new Set(['--title', '-t', '--body', '-b', '--body-file', '-F', '--base', '-B', '--head', '-H',
  '--label', '-l', '--assignee', '-a', '--reviewer', '-r', '--milestone', '-m', '--project', '-p', '--template', '-T', '--repo', '-R']);
function pedeAjuda(args) {
  for (let i = 0; i < args.length; i++) {
    if (COM_VALOR.has(args[i])) { i++; continue; }
    if (args[i] === '--help' || args[i] === '-h') return true;
  }
  return false;
}
const ehAtribuicao = (t) => /^(\$env:)?[A-Za-z_][A-Za-z0-9_]*=/.test(t);
const ehEscape = (t) => /^(\$env:)?ERP_SEM_REVISAO=1$/.test(t);
const nomeDoComando = (t) => basename(t.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');
const caminhoNativo = (p) => p.replace(/^\/([a-zA-Z])\//, '$1:/');

// Acha o `gh pr create` executado. Devolve null ou { args, escape, dir }.
function achaPrCreate(cmd, cwd, powershell = false) {
  let escape = false;
  let dir = cwd;
  for (const seg of segmentos(cmd, powershell)) {
    const texto = seg.join(' ');
    if (/^(export\s+)?(\$env:)?ERP_SEM_REVISAO\s*=\s*1$/.test(texto)) { escape = true; continue; }
    let k = 0;
    let escapeLocal = false;
    while (k < seg.length && ehAtribuicao(seg[k])) { if (ehEscape(seg[k])) escapeLocal = true; k++; }
    let resto = seg.slice(k);
    if (!resto.length) { if (escapeLocal) escape = true; continue; }
    // Prefixos que nao sao o comando: palavra-chave de controle, `time`,
    // `command`..., e a atribuicao do PowerShell (`$url = gh pr create`).
    for (;;) {
      if (PREFIXOS.has(resto[0])) resto = resto.slice(1);
      else if (resto.length > 1 && resto[0].startsWith('$') && resto[1] === '=') resto = resto.slice(2);
      else break;
    }
    if (!resto.length) continue;
    const cmd0 = nomeDoComando(resto[0]);
    if (['cd', 'set-location', 'sl', 'pushd', 'chdir'].includes(cmd0)) {
      const alvo = resto.slice(1).find((t) => !t.startsWith('-'));
      if (alvo) dir = resolve(dir || '.', caminhoNativo(alvo));
      continue;
    }
    if (cmd0 !== 'gh') continue;
    let p = 1;
    while (p < resto.length && resto[p].startsWith('-')) p += (resto[p] === '-R' || resto[p] === '--repo') ? 2 : 1;
    if (resto[p] !== 'pr' || resto[p + 1] !== 'create') continue;
    const args = resto.slice(p + 2);
    if (pedeAjuda(args)) continue;
    return { args, escape: escape || escapeLocal, dir };
  }
  return null;
}

function headDe(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--head' || args[i] === '-H') return args[i + 1] || '';
    if (args[i].startsWith('--head=')) return args[i].slice(7);
  }
  return '';
}

function main() {
  let entrada;
  try {
    entrada = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return 0;
  }
  const cmd = entrada?.tool_input?.command;
  if (typeof cmd !== 'string') return 0;
  const cwd = entrada.cwd && existsSync(entrada.cwd) ? entrada.cwd : process.cwd();
  const achado = achaPrCreate(cmd, cwd, entrada.tool_name === 'PowerShell');
  if (!achado || achado.escape) return 0;

  const dir = existsSync(achado.dir) ? achado.dir : cwd;
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', timeout: 5000 });
  let branch = headDe(achado.args).replace(/^[^:]+:/, '');
  if (!branch) {
    const r = git('rev-parse', '--abbrev-ref', 'HEAD');
    branch = r.status === 0 ? r.stdout.trim() : '';
  }
  if (!branch || branch === 'HEAD') return 0;
  if (/^(chore\/release|docs)\//.test(branch)) return 0;

  const slug = slugDaBranch(branch);
  const arq = join(DIR, slug || '(nome-invalido)');
  const bloqueia = (motivo) => {
    process.stderr.write([
      `BLOQUEADO: PR da branch '${branch}' ${motivo}.`,
      'Antes de abrir a PR, rode o agente revisor-adversarial sobre o diff (Agent com',
      'subagent_type "revisor-adversarial"), corrija os achados CONFIRMADOS e tente de novo.',
      `Quando ele termina com "REVISADO: <branch> <sha>", o hook SubagentStop grava ${arq}.`,
      'PR trivial (sem codigo de produto): ERP_SEM_REVISAO=1 gh pr create ...',
      'Regra: CLAUDE.md > Economia de contexto > Revisao adversarial.',
      '',
    ].join('\n'));
    return 2;
  };

  if (!slug) return bloqueia('com nome de branch invalido');
  if (!existsSync(arq)) return bloqueia('sem revisao adversarial');
  const txt = readFileSync(arq, 'utf8');
  const marcaBranch = /^branch: (.+?)\s*$/m.exec(txt)?.[1];
  const sha = /^sha: ([0-9a-f]{40})\s*$/m.exec(txt)?.[1];
  if (marcaBranch !== branch || !sha) return bloqueia(`com marca de revisao invalida (${arq})`);

  const ref = [branch, `origin/${branch}`].map((b) => git('rev-parse', '--verify', '--quiet', `${b}^{commit}`)).find((r) => r.status === 0);
  if (!ref) return 0;
  const anc = git('merge-base', '--is-ancestor', sha, ref.stdout.trim());
  if (anc.status !== 0) return bloqueia(`com revisao de OUTRO historico (sha ${sha.slice(0, 10)} nao esta na branch; nome reaproveitado?)`);
  return 0;
}

try {
  process.exitCode = main();
} catch {
  process.exitCode = 0;
}
