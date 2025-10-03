
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import Stripe from 'stripe';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PORT = process.env.PORT || 4242;
const stripeKey = process.env.STRIPE_SECRET_KEY || '';

const dataDir = path.join(__dirname, 'data');
const fVerified = path.join(dataDir, 'verified.json');
const fFree     = path.join(dataDir, 'free.json');
const fBlacklist= path.join(dataDir, 'blacklist.json');
const fReports  = path.join(dataDir, 'reports.json');

function readJSON(p, fallback){ try { return JSON.parse(fs.readFileSync(p,'utf-8')); } catch { return fallback; } }
function writeJSON(p, v){ fs.writeFileSync(p, JSON.stringify(v, null, 2)); }

let verified  = readJSON(fVerified, []);
let freePool  = readJSON(fFree, []);
let blacklist = readJSON(fBlacklist, {});
let reports   = readJSON(fReports, []);

function isCode(s){ return /^[A-Z0-9]{6}$/.test(String(s||'').trim().toUpperCase()); }

function requireAdmin(req,res,next){
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD not set' });
  const pwd = req.get('X-Admin-Password') || '';
  if (pwd === ADMIN_PASSWORD) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function removeFromArray(arr, code){
  const C = String(code).toUpperCase();
  const out = arr.filter(x => x !== C);
  return { out, removed: arr.length - out.length };
}

app.get('/health', (req,res)=> res.json({ ok:true }));
app.get('/inventory', (req,res)=> res.json({ verified: verified.length, free: freePool.length }));

app.get('/stats', (req,res)=>{
  const failed = Object.values(blacklist).reduce((a,b)=>a+b,0);
  const worked = reports.filter(r => r.status === 'worked').length;
  res.json({
    verified: verified.length,
    free: freePool.length,
    reports: { total: reports.length, worked, failed },
    recent: reports.slice(-10).reverse()
  });
});

const stripe = new Stripe(stripeKey || '', { apiVersion: '2023-10-16' });

app.post('/create-checkout-session', async (req, res) => {
  try {
    if (!stripeKey) return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });
    const code = verified.length ? verified.shift() : null;
    writeJSON(fVerified, verified);
    const success = code ? `http://localhost:8000/success.html?code=${encodeURIComponent(code)}` : `http://localhost:8000/success.html`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: success,
      cancel_url: 'http://localhost:8000/index.html?canceled=1',
      line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Verified Code (single)' }, unit_amount: 500 }, quantity: 1 }],
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.get('/free/count', (req,res)=> res.json({ remaining: freePool.length }));

app.post('/free/get', (req,res)=>{
  if (!freePool.length) return res.json({ code: null, remaining: 0 });
  const idx   = Math.floor(Math.random() * freePool.length);
  const code  = freePool[idx];
  freePool.splice(idx,1);
  writeJSON(fFree, freePool);
  res.json({ code, remaining: freePool.length });
});

app.post('/free/donate', (req,res)=>{
  const code = String(req.body.code||'').trim().toUpperCase();
  if (!isCode(code)) return res.status(400).json({ error: 'Invalid code format' });
  if (blacklist[code]) return res.status(400).json({ error: 'This code was flagged as invalid' });
  if (freePool.includes(code)) return res.json({ added:false, reason:'duplicate' });
  freePool.push(code);
  writeJSON(fFree, freePool);
  res.json({ added:true, remaining: freePool.length });
});

app.post('/free/report', (req,res)=>{
  const code = String(req.body.code||'').trim().toUpperCase();
  const status = String(req.body.status||'').trim().toLowerCase();
  if (!isCode(code)) return res.status(400).json({ error: 'Invalid code format' });
  if (!['worked','failed'].includes(status)) return res.status(400).json({ error: 'Bad status' });
  reports.push({ code, status, at: Date.now() });
  if (status === 'failed'){
    blacklist[code] = (blacklist[code]||0) + 1;
    const r1 = removeFromArray(freePool, code);
    const r2 = removeFromArray(verified, code);
    freePool = r1.out; verified = r2.out;
    writeJSON(fFree, freePool); writeJSON(fVerified, verified); writeJSON(fBlacklist, blacklist);
  } else {
    writeJSON(fReports, reports);
  }
  res.json({ ok:true });
});

app.post('/admin/login', (req,res)=>{
  if (!ADMIN_PASSWORD) return res.status(500).json({ error:'ADMIN_PASSWORD not set' });
  const pwd = String(req.body.password||'');
  if (pwd === ADMIN_PASSWORD) return res.json({ ok:true });
  return res.status(401).json({ error:'Unauthorized' });
});

app.get('/admin/list', requireAdmin, (req,res)=> res.json({ verified, free: freePool, blacklist, reportsCount: reports.length }));

app.post('/admin/add-verified', requireAdmin, (req,res)=>{
  const code = String(req.body.code||'').trim().toUpperCase();
  if (!isCode(code)) return res.status(400).json({ error:'Invalid code format' });
  if (!verified.includes(code)) verified.push(code);
  writeJSON(fVerified, verified);
  res.json({ added:true, count: verified.length });
});

app.post('/admin/add-verified-bulk', requireAdmin, (req,res)=>{
  const incoming = Array.isArray(req.body.codes)? req.body.codes : [];
  const set = new Set(verified);
  let added=0, skipped=0;
  for (const raw of incoming){
    const c = String(raw||'').trim().toUpperCase();
    if (!isCode(c) || set.has(c)) { skipped++; continue; }
    set.add(c); verified.push(c); added++;
  }
  writeJSON(fVerified, verified);
  res.json({ added, skipped, count: verified.length });
});

app.post('/admin/add-free-bulk', (req,res)=>{
  const incoming = Array.isArray(req.body.codes)? req.body.codes : [];
  const set = new Set(freePool);
  let added=0, skipped=0;
  for (const raw of incoming){
    const c = String(raw||'').trim().toUpperCase();
    if (!isCode(c) || set.has(c) || blacklist[c]) { skipped++; continue; }
    set.add(c); freePool.push(c); added++;
  }
  writeJSON(fFree, freePool);
  res.json({ added, skipped, count: freePool.length });
});

app.post('/admin/delete-verified', requireAdmin, (req,res)=>{
  const code = String(req.body.code||'').trim().toUpperCase();
  const r = removeFromArray(verified, code);
  verified = r.out; writeJSON(fVerified, verified);
  res.json({ removed: r.removed, count: verified.length });
});

app.post('/admin/clear-verified', requireAdmin, (req,res)=>{ verified = []; writeJSON(fVerified, verified); res.json({ ok:true }); });
app.post('/admin/clear-free', requireAdmin, (req,res)=>{ freePool = []; writeJSON(fFree, freePool); res.json({ ok:true }); });
app.get('/admin/export', requireAdmin, (req,res)=> res.json({ verified, free: freePool, blacklist }));

app.listen(PORT, ()=> console.log(`Server running on http://localhost:${PORT}`));
