import { readFile,writeFile,copyFile,mkdir,cp } from 'node:fs/promises';
await mkdir('backend',{recursive:true});
const data=JSON.parse(await readFile('public/data/earth/atlas.json','utf8'));
const worker=await readFile('server/worker.js','utf8');
await writeFile('backend/worker.js',`${worker}\nexport default createWorker(${JSON.stringify(data.regions.map(r=>r[0]))});\n`);
await copyFile('server/schema.js','backend/schema.js');
console.log('Backend source prepared with',data.regions.length,'valid regions.');
