import { readFile,writeFile,copyFile,mkdir,cp } from 'node:fs/promises';
await mkdir('backend',{recursive:true});
const data=JSON.parse(await readFile('public/data/china.json','utf8'));
const worker=await readFile('server/worker.js','utf8');
await writeFile('backend/worker.js',`${worker}\nexport default createWorker(${JSON.stringify(data.cities.map(c=>c.id))});\n`);
await copyFile('server/schema.js','backend/schema.js');
console.log('Backend source prepared with',data.cities.length,'valid regions.');
