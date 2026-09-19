import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { createHash } from 'node:crypto';

await mkdir('release', { recursive: true });
const files = {};
for (const file of await readdir('dist', { withFileTypes: true })) {
  if (file.isFile()) files[file.name] = new Uint8Array(await readFile(join('dist', file.name)));
}
for (const file of ['README.md', 'COMPATIBILITY.md', 'THIRD_PARTY_NOTICES.md', 'VALIDATION.md']) files[file] = new Uint8Array(await readFile(file));
files['docs/DEVELOPMENT.md'] = new Uint8Array(await readFile('docs/DEVELOPMENT.md'));
files['docs/STREAMING.md'] = new Uint8Array(await readFile('docs/STREAMING.md'));
files['docs/VIDEO.md'] = new Uint8Array(await readFile('docs/VIDEO.md'));
const gatewayFiles = {};
for (const file of ['server.mjs','workflow.mjs','mcp_client.py','fasth3.json','companion.html','README.md','Start-Wayfarer-Video.ps1','Start-Wayfarer-Video.cmd','Start-Wayfarer-PC-Companion.cmd']) {
  const bytes = new Uint8Array(await readFile(join('gateway',file)));
  files[`gateway/${file}`] = bytes; gatewayFiles[`gateway/${file}`] = bytes;
}
gatewayFiles['docs/VIDEO.md'] = files['docs/VIDEO.md'];
gatewayFiles['VALIDATION.md'] = files['VALIDATION.md'];
gatewayFiles['README.md'] = strToU8('# Wayfarer PC Companion\n\nExtract this ZIP, then open **gateway/Start-Wayfarer-PC-Companion.cmd** on your Windows PC.\n\nRead [Start here](gateway/README.md) for requirements, connection codes, and phone setup. Install the separate Wayfarer mini-app ZIP in Layla.\n');
gatewayFiles['Start-Wayfarer-PC-Companion.cmd'] = strToU8('@echo off\r\ncall "%~dp0gateway\\Start-Wayfarer-PC-Companion.cmd"\r\n');
for (const file of await readdir('docs/screenshots')) {
  if (file.endsWith('.png')) files[`docs/screenshots/${file}`] = new Uint8Array(await readFile(join('docs/screenshots', file)));
}
files['licenses/Inner-Self-MIT.txt'] = new Uint8Array(await readFile('src/vendor/inner-self/LICENSE'));
files['licenses/Auto-Cards-MIT.txt'] = new Uint8Array(await readFile('src/vendor/auto-cards/LICENSE'));
for (const dependency of ['@layla-network/sdk', 'react', 'react-dom', 'lucide-react', 'quickjs-emscripten-core', '@jitl/quickjs-singlefile-browser-release-sync', 'openai']) {
  files[`licenses/${dependency.replaceAll('/', '-').replace('@', '')}.txt`] = new Uint8Array(await readFile(`node_modules/${dependency}/LICENSE`));
}
const zip = zipSync(files, { level: 6 });
const contents = unzipSync(zip);
const metadata = JSON.parse(new TextDecoder().decode(contents['app.json']));
for (const required of ['app.json', 'index.html', metadata.iconUri, metadata.backgroundImgUri]) {
  if (!contents[required]) throw new Error(`ZIP is missing ${required} at its root`);
}
const html = new TextDecoder().decode(contents['index.html']);
if (/<script[^>]+src=|<link[^>]+href="\.\/assets/.test(html)) throw new Error('App is not self-contained');
if (html.includes('wayfarer-demo-v1')) {
  // Storage label is harmless, but no canned model passage may reach the release.
  if (html.includes('Finch raises the lantern, and its blue moths')) throw new Error('Demo response leaked into production');
}
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const filename = `wayfarer-${version}.zip`;
await writeFile(join('release', filename), zip);
const checksum = createHash('sha256').update(zip).digest('hex');
await writeFile(join('release', filename + '.sha256'), `${checksum}  ${filename}\n`);
const gatewayZip = zipSync(gatewayFiles,{level:6});
const gatewayName = `wayfarer-pc-companion-${version}.zip`;
await writeFile(join('release',gatewayName),gatewayZip);
await writeFile(join('release',gatewayName+'.sha256'),`${createHash('sha256').update(gatewayZip).digest('hex')}  ${gatewayName}\n`);
console.log(`Packaged ${filename} (${(zip.length / 1024 / 1024).toFixed(2)} MB), ${Object.keys(contents).length} files; root assets verified.`);
console.log(`SHA256 ${checksum}`);
console.log(`Packaged ${gatewayName} (${Object.keys(gatewayFiles).length} files).`);
