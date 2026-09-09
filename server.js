
const express=require("express");
const session=require("express-session");
const bcrypt=require("bcryptjs");
const helmet=require("helmet");
const rateLimit=require("express-rate-limit");
const path=require("path");
const {Pool}=require("pg");

const app=express();
const PORT=process.env.PORT||3000;
const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false
});
const ADMIN_EMAIL=(process.env.ADMIN_EMAIL||"").toLowerCase();

app.set("trust proxy",1);
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"250kb"}));
app.use(express.urlencoded({extended:true,limit:"250kb"}));
app.use(session({
  secret:process.env.SESSION_SECRET||"dev-only-change-me",
  resave:false,
  saveUninitialized:false,
  cookie:{
    httpOnly:true,
    sameSite:"lax",
    secure:process.env.NODE_ENV==="production",
    maxAge:7*24*60*60*1000
  }
}));
app.use(express.static(path.join(__dirname,"public")));
app.use("/api/login",rateLimit({windowMs:15*60*1000,limit:20}));
app.use("/api/register",rateLimit({windowMs:15*60*1000,limit:20}));

const auth=(req,res,next)=>req.session.userId?next():res.status(401).json({error:"Login required."});
const clean=(s,n=500)=>String(s||"").replace(/[<>]/g,"").trim().slice(0,n);

async function getUser(id){
  const {rows}=await pool.query("SELECT * FROM users WHERE id=$1",[id]);
  return rows[0];
}
function safe(u){
  if(!u)return null;
  const {password_hash,...x}=u;
  return x;
}
async function blocked(a,b){
  const {rowCount}=await pool.query(
    "SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1) LIMIT 1",
    [a,b]
  );
  return rowCount>0;
}
async function compatible(me,u){
  if(!me||!u||me.country!==u.country)return false;
  if(await blocked(me.id,u.id))return false;
  if(me.seeking!=="everyone"&&u.gender!==me.seeking)return false;
  if(u.seeking!=="everyone"&&me.gender!==u.seeking)return false;
  return true;
}
async function notify(userId,type,text,fromId=null){
  await pool.query(
    "INSERT INTO notifications(user_id,type,text,from_id) VALUES($1,$2,$3,$4)",
    [userId,type,text,fromId]
  );
}

app.use("/api",async(req,res,next)=>{
  try{
    if(req.session.userId){
      await pool.query("UPDATE users SET last_seen=NOW() WHERE id=$1",[req.session.userId]);
    }
    next();
  }catch(e){next(e)}
});

app.post("/api/register",async(req,res)=>{
  try{
    const {name,email,password,age,city,country,language,gender,seeking}=req.body;
    const e=String(email||"").trim().toLowerCase();
    if(!name||!e||!password||!age||!city||!country||!language||!gender||!seeking)
      return res.status(400).json({error:"Complete all fields."});
    if(+age<18)return res.status(400).json({error:"18+ required."});
    if(String(password).length<8)return res.status(400).json({error:"Password must be at least 8 characters."});
    const hash=await bcrypt.hash(password,12);
    const isAdmin=ADMIN_EMAIL&&e===ADMIN_EMAIL;
    const q=await pool.query(
      `INSERT INTO users(name,email,password_hash,age,city,country,language,gender,seeking,is_admin)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [clean(name,80),e,hash,+age,clean(city,80),country,language,gender,seeking,!!isAdmin]
    );
    const u=q.rows[0];
    await pool.query(
      "INSERT INTO transactions(user_id,type,coins,label) VALUES($1,'welcome',100,'Welcome bonus')",
      [u.id]
    );
    req.session.userId=u.id;
    res.json({ok:true});
  }catch(e){
    if(e.code==="23505")return res.status(400).json({error:"Email already registered."});
    console.error(e);res.status(500).json({error:"Server error."});
  }
});

app.post("/api/login",async(req,res)=>{
  const e=String(req.body.email||"").trim().toLowerCase();
  const {rows}=await pool.query("SELECT * FROM users WHERE email=$1",[e]);
  const u=rows[0];
  if(!u||!(await bcrypt.compare(req.body.password||"",u.password_hash)))
    return res.status(400).json({error:"Incorrect email or password."});
  req.session.userId=u.id;
  res.json({ok:true});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",auth,async(req,res)=>res.json(safe(await getUser(req.session.userId))));

app.post("/api/profile",auth,async(req,res)=>{
  const {name,age,city,bio,country,language,gender,seeking}=req.body;
  if(!name||+age<18||!city)return res.status(400).json({error:"Check profile."});
  await pool.query(
    `UPDATE users SET name=$1,age=$2,city=$3,bio=$4,country=$5,language=$6,gender=$7,seeking=$8 WHERE id=$9`,
    [clean(name,80),+age,clean(city,80),clean(bio,500),country,language,gender,seeking,req.session.userId]
  );
  res.json({ok:true});
});

app.get("/api/profiles",auth,async(req,res)=>{
  const me=await getUser(req.session.userId);
  const min=Math.max(18,+req.query.minAge||18);
  const max=Math.min(99,+req.query.maxAge||99);
  const city=clean(req.query.city,80).toLowerCase();
  const gender=String(req.query.gender||"");
  const verified=req.query.verified==="1";
  const online=req.query.online==="1";
  let sql=`SELECT * FROM users WHERE id<>$1 AND country=$2 AND age BETWEEN $3 AND $4`;
  const p=[me.id,me.country,min,max];
  if(city){p.push("%"+city+"%");sql+=` AND LOWER(city) LIKE $${p.length}`;}
  if(gender){p.push(gender);sql+=` AND gender=$${p.length}`;}
  if(verified)sql+=" AND verified=TRUE";
  if(online)sql+=" AND last_seen > NOW()-INTERVAL '5 minutes'";
  sql+=" ORDER BY last_seen DESC LIMIT 100";
  const {rows}=await pool.query(sql,p);
  const out=[];
  for(const u of rows){
    if(await compatible(me,u))out.push(safe(u));
  }
  res.json(out);
});

app.post("/api/like/:id",auth,async(req,res)=>{
  const from=req.session.userId,to=+req.params.id;
  const me=await getUser(from),target=await getUser(to);
  if(!(await compatible(me,target)))return res.status(400).json({error:"Profile unavailable."});
  await pool.query(
    "INSERT INTO likes(from_id,to_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [from,to]
  );
  await notify(to,"like",me.name+" liked you.",from);
  const {rowCount}=await pool.query("SELECT 1 FROM likes WHERE from_id=$1 AND to_id=$2",[to,from]);
  if(rowCount){await notify(from,"match","You matched with "+target.name+".",to);}
  res.json({ok:true,match:rowCount>0});
});

app.post("/api/pass/:id",auth,async(req,res)=>{
  await pool.query(
    "INSERT INTO passes(from_id,to_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [req.session.userId,+req.params.id]
  );
  res.json({ok:true});
});

app.get("/api/matches",auth,async(req,res)=>{
  const {rows}=await pool.query(
    `SELECT u.id,u.name,u.age,u.city,u.avatar,u.verified,u.last_seen
     FROM likes a JOIN likes b ON a.to_id=b.from_id AND a.from_id=b.to_id
     JOIN users u ON u.id=a.to_id
     WHERE a.from_id=$1`,
    [req.session.userId]
  );
  res.json(rows);
});

app.get("/api/messages/:id",auth,async(req,res)=>{
  const other=+req.params.id;
  if(await blocked(req.session.userId,other))return res.status(403).json({error:"Conversation unavailable."});
  const {rows}=await pool.query(
    `SELECT * FROM messages
     WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)
     ORDER BY created_at ASC`,
    [req.session.userId,other]
  );
  res.json(rows);
});

app.post("/api/messages/:id",auth,async(req,res)=>{
  const other=+req.params.id;
  const text=clean(req.body.text,2000);
  const me=await getUser(req.session.userId),target=await getUser(other);
  if(!(await compatible(me,target)))return res.status(403).json({error:"Profile unavailable."});
  if(!text)return res.status(400).json({error:"Message required."});
  if(me.coins<5)return res.status(402).json({error:"Not enough coins."});
  await pool.query("BEGIN");
  try{
    await pool.query("UPDATE users SET coins=coins-5 WHERE id=$1",[me.id]);
    await pool.query(
      "INSERT INTO messages(sender_id,receiver_id,text) VALUES($1,$2,$3)",
      [me.id,other,text]
    );
    await notify(other,"message","New message from "+me.name+".",me.id);
    await pool.query("COMMIT");
  }catch(e){await pool.query("ROLLBACK");throw e;}
  const updated=await getUser(me.id);
  res.json({coins:updated.coins});
});

app.get("/api/conversations",auth,async(req,res)=>{
  const uid=req.session.userId;
  const {rows}=await pool.query(
    `SELECT DISTINCT ON (other_id)
      other_id AS id,u.name,u.avatar,u.last_seen,
      CASE WHEN m.image_path<>'' THEN 'Fotoğraf' ELSE m.text END AS last
     FROM (
       SELECT CASE WHEN sender_id=$1 THEN receiver_id ELSE sender_id END AS other_id, *
       FROM messages
       WHERE sender_id=$1 OR receiver_id=$1
     ) m
     JOIN users u ON u.id=m.other_id
     ORDER BY other_id,m.created_at DESC`,
    [uid]
  );
  res.json(rows);
});

app.get("/api/notifications",auth,async(req,res)=>{
  const {rows}=await pool.query(
    "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
    [req.session.userId]
  );
  res.json(rows);
});
app.post("/api/notifications/seen",auth,async(req,res)=>{
  await pool.query("UPDATE notifications SET seen=TRUE WHERE user_id=$1",[req.session.userId]);
  res.json({ok:true});
});

app.get("/api/coin-packages",auth,(req,res)=>res.json({
  starter:{coins:50,label:"Starter",price:"€2.99"},
  popular:{coins:150,label:"Popular",price:"€6.99"},
  max:{coins:400,label:"Max",price:"€14.99"},
  mega:{coins:1000,label:"Mega",price:"€29.99"}
}));
app.get("/api/transactions",auth,async(req,res)=>{
  const {rows}=await pool.query(
    "SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC",
    [req.session.userId]
  );
  res.json(rows);
});
app.post("/api/coin-packages/:key/buy",auth,(req,res)=>{
  res.status(501).json({error:"Real payment provider will be connected here."});
});

app.post("/api/block/:id",auth,async(req,res)=>{
  await pool.query(
    "INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [req.session.userId,+req.params.id]
  );
  res.json({ok:true});
});
app.post("/api/report/:id",auth,async(req,res)=>{
  await pool.query(
    "INSERT INTO reports(reporter_id,reported_id,reason) VALUES($1,$2,$3)",
    [req.session.userId,+req.params.id,clean(req.body.reason,300)||"Other"]
  );
  res.json({ok:true});
});

async function requireAdmin(req,res,next){
  const u=await getUser(req.session.userId);
  if(!u?.is_admin)return res.status(403).json({error:"Admin only."});
  next();
}
app.get("/api/admin/stats",auth,requireAdmin,async(req,res)=>{
  const [u,r,m,t]=await Promise.all([
    pool.query("SELECT COUNT(*) FROM users"),
    pool.query("SELECT COUNT(*) FROM reports WHERE status='open'"),
    pool.query("SELECT COUNT(*) FROM messages"),
    pool.query("SELECT COUNT(*) FROM transactions")
  ]);
  res.json({users:+u.rows[0].count,reports:+r.rows[0].count,messages:+m.rows[0].count,transactions:+t.rows[0].count,pendingVerification:0});
});
app.get("/api/admin/users",auth,requireAdmin,async(req,res)=>{
  const {rows}=await pool.query("SELECT id,name,email,country,city,verified,email_verified,verification_status,coins,is_admin FROM users ORDER BY id DESC");
  res.json(rows);
});
app.get("/api/admin/reports",auth,requireAdmin,async(req,res)=>{
  const {rows}=await pool.query("SELECT * FROM reports ORDER BY id DESC");
  res.json(rows);
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Server error."})});
app.listen(PORT,()=>console.log("NordMatch production server running on port "+PORT));
