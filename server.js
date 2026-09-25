const express=require('express'); const cors=require('cors'); const crypto=require('crypto');
const app=express(); app.use(cors()); app.use(express.json()); app.use(express.static('public'));
const sessions=new Map();
function id(){return crypto.randomBytes(5).toString('hex')}
app.get('/api/sessions',(req,res)=>res.json([...sessions.values()]));
app.post('/api/sessions',(req,res)=>{const {name,phone}=req.body||{}; if(!name||!phone)return res.status(400).json({error:'Nama dan nomor wajib diisi'}); const s={id:id(),name,phone,status:'stopped',pairing:null,createdAt:new Date().toISOString()}; sessions.set(s.id,s); res.json(s)});
app.post('/api/sessions/:id/pair',(req,res)=>{const s=sessions.get(req.params.id); if(!s)return res.sendStatus(404); s.pairing=String(Math.floor(100000+Math.random()*900000)); s.status='pairing'; res.json({pairing:s.pairing,status:s.status})});
app.post('/api/sessions/:id/:action',(req,res)=>{const s=sessions.get(req.params.id); if(!s)return res.sendStatus(404); if(req.params.action==='start')s.status='online'; else if(req.params.action==='stop')s.status='stopped'; else if(req.params.action==='restart')s.status='online'; else return res.status(400).json({error:'Aksi tidak dikenal'}); res.json(s)});
app.delete('/api/sessions/:id',(req,res)=>{if(!sessions.delete(req.params.id))return res.sendStatus(404);res.json({ok:true})});
const port=process.env.PORT||3000; app.listen(port,()=>console.log('Tenka Panel listening on '+port));
