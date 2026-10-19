// Local stand-in for the Cloudflare API so 'wrangler pages deploy' can build the exact
// deployment payload (manifest + Functions bundle) without any Cloudflare credentials.
// The captured payload (cap/deploy.bin) is then submitted through the Cloudflare connector.
// Usage: see docs/DEPLOY.md
const http=require('http'),fs=require('fs');
const jwt='x.'+Buffer.from(JSON.stringify({max_file_count_allowed:20000,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.y';
http.createServer((req,res)=>{
  const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
    const body=Buffer.concat(chunks);
    console.log(req.method,req.url,body.length,req.headers['content-type']);
    const ok=r=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({success:true,errors:[],messages:[],result:r}))};
    if(req.url.endsWith('/upload-token')) return ok({jwt});
    if(req.url.endsWith('/check-missing')) { fs.writeFileSync('cap/hashes.json',body); return ok([]); }
    if(req.url.endsWith('/upsert-hashes')) return ok(true);
    if(req.method==='POST'&&req.url.endsWith('/deployments')){ fs.writeFileSync('cap/deploy.bin',body); fs.writeFileSync('cap/ct.txt',req.headers['content-type']); return ok({id:'mock',url:'https://mock'}); }
    if(req.method==='GET'&&/pages\/projects\/grokvshumans$/.test(req.url)) return ok({name:'grokvshumans',production_branch:'main',deployment_configs:{production:{},preview:{}}});
    ok({});
  });
}).listen(8799,()=>console.log('up'));
