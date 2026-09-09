
const fs=require("fs");
const path=require("path");
const {Pool}=require("pg");
(async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false});
  const sql=fs.readFileSync(path.join(__dirname,"..","schema.sql"),"utf8");
  await pool.query(sql);
  console.log("Database ready.");
  await pool.end();
})().catch(e=>{console.error(e);process.exit(1)});
