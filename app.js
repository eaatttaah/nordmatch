
const SUPABASE_URL = "https://tmolmicahqjudwtxaejd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_de_8icaR1H8Z-YrWO08IQg_rGqOb-0x";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const app = document.getElementById('app');
const countries = ['Danimarka','Türkiye','Norveç','İsveç','Almanya','İngiltere','Fransa','Hollanda','Belçika','İsviçre','Avusturya','İspanya','İtalya','Polonya','Macaristan'];
const languages = ['Türkçe','Dansk','English','Deutsch','Svenska','Norsk','Français','Nederlands','Italiano','Español','Polski'];

const state = {
  locale: JSON.parse(localStorage.getItem('nm_locale') || 'null'),
  session: null,
  user: null,
  profile: null,
  authTab: 'login',
  view: 'discover',
  profiles: [],
  conversations: [],
  selectedConversation: null,
  selectedPartner: null,
  messages: [],
  wallet: null,
  toast: '',
  authMessage: '',
  realtimeChannel: null
};

function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function initials(n='N'){return (n||'N').slice(0,1).toUpperCase()}
function toast(msg){state.toast=msg;render();setTimeout(()=>{state.toast='';render()},1800)}

async function boot(){
  const { data: { session } } = await supabase.auth.getSession();
  state.session = session;
  state.user = session?.user || null;
  if(state.user) await loadCurrentProfile();
  render();

  supabase.auth.onAuthStateChange(async (_event, session)=>{
    state.session=session;
    state.user=session?.user||null;
    if(state.user) await loadCurrentProfile();
    else state.profile=null;
    render();
  });
}

async function loadCurrentProfile(){
  const {data,error}=await supabase.from('profiles').select('*').eq('id',state.user.id).single();
  if(error) console.error(error);
  state.profile=data||null;
  const {data:w}=await supabase.from('wallets').select('*').eq('user_id',state.user.id).maybeSingle();
  state.wallet=w||null;
}

async function loadProfiles(){
  if(!state.user) return;
  let q=supabase.from('profiles').select('*').neq('id',state.user.id).order('created_at',{ascending:false});
  const {data,error}=await q;
  if(error) return toast('Profiller alınamadı');
  state.profiles=data||[];
}

async function loadConversations(){
  const uid=state.user.id;
  const {data,error}=await supabase.from('conversations').select('*').or(`user_1.eq.${uid},user_2.eq.${uid}`).order('updated_at',{ascending:false});
  if(error){console.error(error);return}
  const convs=data||[];
  const partnerIds=[...new Set(convs.map(c=>c.user_1===uid?c.user_2:c.user_1))];
  let people=[];
  if(partnerIds.length){
    const {data:p}=await supabase.from('profiles').select('*').in('id',partnerIds);
    people=p||[];
  }
  state.conversations=convs.map(c=>({
    ...c,
    partner:people.find(p=>p.id===(c.user_1===uid?c.user_2:c.user_1))
  }));
}

async function openConversationByUser(targetId){
  const {data,error}=await supabase.rpc('get_or_create_conversation',{target_user:targetId});
  if(error){console.error(error);return toast('Sohbet açılamadı. SQL patch çalıştı mı?')}
  await loadConversations();
  state.selectedConversation=data;
  state.selectedPartner=state.profiles.find(p=>p.id===targetId) || state.conversations.find(c=>c.id===data)?.partner || null;
  await loadMessages(data);
  state.view='messages';
  subscribeMessages(data);
  render();
}

async function loadMessages(conversationId){
  const {data,error}=await supabase.from('messages').select('*').eq('conversation_id',conversationId).order('created_at',{ascending:true});
  if(error){console.error(error);return}
  state.messages=data||[];
}

function subscribeMessages(conversationId){
  if(state.realtimeChannel) supabase.removeChannel(state.realtimeChannel);
  state.realtimeChannel=supabase.channel('conversation-'+conversationId)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${conversationId}`},payload=>{
      if(!state.messages.some(m=>m.id===payload.new.id)){
        state.messages.push(payload.new);
        render();
        setTimeout(()=>{const a=document.getElementById('chatarea');if(a)a.scrollTop=a.scrollHeight},0);
      }
    })
    .subscribe();
}

function localeView(){
 return `<div class="welcome"><div class="welcome-card card">
 <div class="brand"><div class="brandmark">N</div>NordMatch</div>
 <h1>Ülkeni ve dilini seç.</h1>
 <p>Bu seçim kayıt ekranını ve profil varsayılanlarını ayarlayacak.</p>
 <form id="localeForm"><div class="locale-grid">
 <div class="field"><label>Ülke</label><select name="country">${countries.map(x=>`<option>${x}</option>`).join('')}</select></div>
 <div class="field"><label>Dil</label><select name="language">${languages.map(x=>`<option>${x}</option>`).join('')}</select></div>
 </div><button class="btn btn-dark" style="width:100%">Devam et</button></form></div></div>`;
}

function authView(){
 return `<div class="auth"><section class="auth-left"><div><div class="brand"><div class="brandmark">N</div>NordMatch</div><h1>Gerçek kullanıcılarla gerçek bağlantılar.</h1><p>Supabase bağlı kayıt, profil, fotoğraf, eşleşme ve mesajlaşma sistemi.</p></div><small class="muted">${esc(state.locale.country)} · ${esc(state.locale.language)}</small></section>
 <section class="auth-panel"><div class="auth-box card"><div class="brand"><div class="brandmark">N</div>NordMatch</div>
 <div class="tabs"><button data-tab="login" class="${state.authTab==='login'?'active':''}">Giriş</button><button data-tab="register" class="${state.authTab==='register'?'active':''}">Kayıt</button></div>
 ${state.authMessage?`<div class="alert ${state.authMessage.startsWith('HATA:')?'err':'ok'}">${esc(state.authMessage.replace('HATA:',''))}</div>`:''}
 ${state.authTab==='login'?loginForm():registerForm()}
 </div></section></div>`;
}

function loginForm(){
 return `<form id="loginForm"><div class="field"><label>E-posta</label><input type="email" name="email" required></div><div class="field"><label>Şifre</label><input type="password" name="password" required></div><button class="btn btn-dark" style="width:100%">Giriş yap</button></form>`;
}

function registerForm(){
 return `<form id="registerForm"><div class="form-grid">
 <div class="field"><label>Ad</label><input name="name" required></div>
 <div class="field"><label>Yaş</label><input name="age" type="number" min="18" max="99" required></div>
 <div class="field full"><label>E-posta</label><input name="email" type="email" required></div>
 <div class="field"><label>Şehir</label><input name="city" required></div>
 <div class="field"><label>Ülke</label><select name="country">${countries.map(c=>`<option ${c===state.locale.country?'selected':''}>${c}</option>`).join('')}</select></div>
 <div class="field"><label>Cinsiyet</label><select name="gender"><option>Kadın</option><option>Erkek</option><option>Diğer</option></select></div>
 <div class="field"><label>Aradığın</label><select name="looking_for"><option>Kadın</option><option>Erkek</option><option>Herkes</option></select></div>
 <div class="field full"><label>Şifre</label><input name="password" type="password" minlength="6" required></div>
 </div><button class="btn btn-dark" style="width:100%">Ücretsiz kayıt ol</button></form>`;
}

function shellView(){
 const p=state.profile||{};
 return `<div><header class="topbar"><div class="brand"><div class="brandmark">N</div>NordMatch</div><div class="top-actions">
 <button class="iconbtn" data-view="wallet">◈ ${state.wallet?.balance??0}</button>
 <div class="avatar">${p.avatar_url?`<img src="${esc(p.avatar_url)}">`:initials(p.name)}</div>
 </div></header>
 <div class="main"><aside class="sidebar">
 ${nav('discover','⌕','Keşfet')}${nav('messages','✉','Mesajlar')}${nav('profile','◯','Profilim')}${nav('matches','♥','Eşleşmeler')}${nav('wallet','◈','Jetonlar')}
 <button class="sidebtn" id="logout">↪ Çıkış</button>
 </aside><main class="content">${viewContent()}</main></div>
 ${state.toast?`<div class="toast">${esc(state.toast)}</div>`:''}</div>`;
}

function nav(v,i,t){return `<button class="sidebtn ${state.view===v?'active':''}" data-view="${v}">${i} ${t}</button>`}

function viewContent(){
 if(state.view==='discover') return discoverView();
 if(state.view==='messages') return messagesView();
 if(state.view==='profile') return profileView();
 if(state.view==='matches') return matchesView();
 if(state.view==='wallet') return walletView();
 return discoverView();
}

function discoverView(){
 return `<div class="pagehead"><div><h1>Keşfet</h1><p>Gerçek kayıtlı profiller burada görünür.</p></div><div class="filters"><input id="search" placeholder="İsim veya şehir ara"><select id="countryFilter"><option value="">Tüm ülkeler</option>${countries.map(c=>`<option>${c}</option>`).join('')}</select></div></div>
 <div class="profile-grid" id="grid">${state.profiles.length?state.profiles.map(profileCard).join(''):`<div class="empty card">Henüz başka kullanıcı yok. İkinci bir hesap açtığında burada görünecek.</div>`}</div>`;
}

function profileCard(p){
 const bg=['#7f8c8d','#34495e'];
 return `<article class="p-card card" data-name="${esc((p.name||'').toLowerCase())}" data-city="${esc((p.city||'').toLowerCase())}" data-country="${esc(p.country||'')}">
 <div class="p-photo" style="--c1:${bg[0]};--c2:${bg[1]}">${p.avatar_url?`<img src="${esc(p.avatar_url)}">`:`<div class="bigletter">${initials(p.name)}</div>`}${p.is_verified?'<span class="badge">✓ Doğrulanmış</span>':''}</div>
 <div class="p-body"><div class="name-line"><h3>${esc(p.name||'İsimsiz')}${p.age?`, ${p.age}`:''}</h3>${p.is_online?'<span class="dot"></span>':''}</div>
 <div class="meta">${esc(p.city||'')}${p.country?` · ${esc(p.country)}`:''}${p.job?` · ${esc(p.job)}`:''}</div>
 ${p.bio?`<div class="bio">${esc(p.bio)}</div>`:''}
 <div class="actions"><button class="btn btn-light" data-like="${p.id}">♡ Beğen</button><button class="btn btn-dark" data-msg="${p.id}">Mesaj</button></div></div></article>`;
}

function messagesView(){
 return `<div class="pagehead"><div><h1>Mesajlar</h1><p>Mesajlar Supabase veritabanında saklanır.</p></div></div>
 <div class="messages card"><section class="threads"><div class="thread-title"><strong>Sohbetler</strong></div>
 ${state.conversations.length?state.conversations.map(c=>`<div class="thread ${c.id===state.selectedConversation?'active':''}" data-conv="${c.id}">
 <div class="round">${c.partner?.avatar_url?`<img src="${esc(c.partner.avatar_url)}">`:initials(c.partner?.name)}</div><div class="tcopy"><strong>${esc(c.partner?.name||'Kullanıcı')}</strong><span>Sohbeti aç</span></div></div>`).join(''):`<div class="empty">Henüz sohbet yok.</div>`}
 </section>
 <section class="chat">${state.selectedConversation?chatPane():`<div class="empty">Bir sohbet seç veya Keşfet ekranından bir kullanıcıya mesaj gönder.</div>`}</section></div>`;
}

function chatPane(){
 const p=state.selectedPartner||state.conversations.find(c=>c.id===state.selectedConversation)?.partner;
 return `<div class="chathead"><div class="chatperson"><div class="round">${p?.avatar_url?`<img src="${esc(p.avatar_url)}">`:initials(p?.name)}</div><div><strong>${esc(p?.name||'Kullanıcı')}</strong><div class="muted" style="font-size:13px">${esc(p?.city||'')}</div></div></div>
 <div><button class="btn btn-light" id="reportBtn">Şikâyet</button> <button class="btn btn-danger" id="blockBtn">Engelle</button></div></div>
 <div class="chatarea" id="chatarea">${state.messages.map(m=>`<div class="row ${m.sender_id===state.user.id?'me':''}"><div class="bubble">${esc(m.message_text)}</div></div>`).join('')}</div>
 <form id="chatForm" class="chatinput"><input name="message" maxlength="3000" placeholder="Mesaj yaz..." required><button>Gönder</button></form>`;
}

function profileView(){
 const p=state.profile||{};
 return `<div class="pagehead"><div><h1>Profilim</h1><p>Bilgilerini güncelle.</p></div></div><div class="profile-layout">
 <section class="profile-summary card"><div class="photo-upload">${p.avatar_url?`<img src="${esc(p.avatar_url)}">`:initials(p.name)}</div><h2>${esc(p.name||'')}${p.age?`, ${p.age}`:''}</h2><p class="muted">${esc(p.city||'')}, ${esc(p.country||'')}</p>
 <div style="margin-top:12px"><label class="btn btn-light">Fotoğraf yükle<input type="file" id="photoInput" accept="image/*" hidden></label></div>
 <div class="stats"><div class="stat"><strong>◈ ${state.wallet?.balance??0}</strong><span>Jeton</span></div><div class="stat"><strong>${state.conversations.length}</strong><span>Sohbet</span></div><div class="stat"><strong>${p.is_verified?'✓':'—'}</strong><span>Doğrulama</span></div></div></section>
 <section class="edit-card card"><h2 style="margin-top:0">Profil bilgileri</h2><form id="profileForm"><div class="form-grid">
 <div class="field"><label>Ad</label><input name="name" value="${esc(p.name||'')}" required></div>
 <div class="field"><label>Yaş</label><input name="age" type="number" min="18" max="99" value="${p.age||''}" required></div>
 <div class="field"><label>Şehir</label><input name="city" value="${esc(p.city||'')}"></div>
 <div class="field"><label>Ülke</label><select name="country">${countries.map(c=>`<option ${c===p.country?'selected':''}>${c}</option>`).join('')}</select></div>
 <div class="field"><label>Dil</label><select name="language">${languages.map(l=>`<option ${l===p.language?'selected':''}>${l}</option>`).join('')}</select></div>
 <div class="field"><label>Meslek</label><input name="job" value="${esc(p.job||'')}"></div>
 <div class="field full"><label>Hakkımda</label><textarea name="bio" rows="5">${esc(p.bio||'')}</textarea></div>
 </div><button class="btn btn-dark">Kaydet</button></form></section></div>`;
}

function matchesView(){
 return `<div class="pagehead"><div><h1>Eşleşmeler</h1><p>Karşılıklı beğeniler.</p></div></div><div id="matchesList" class="list"><div class="empty card">Yükleniyor...</div></div>`;
}

function walletView(){
 return `<div class="pagehead"><div><h1>Jetonlar</h1><p>Gerçek bakiye veritabanından geliyor.</p></div></div><div class="card" style="padding:24px"><div class="muted">Mevcut bakiye</div><div style="font-size:44px;font-weight:900;margin:8px 0">◈ ${state.wallet?.balance??0}</div><p class="muted">Gerçek ödeme henüz bağlı değil. Bakiye kullanıcı tarafından doğrudan değiştirilemez.</p></div>`;
}

async function loadMatches(){
 const uid=state.user.id;
 const {data,error}=await supabase.from('matches').select('*').or(`user_1.eq.${uid},user_2.eq.${uid}`).order('created_at',{ascending:false});
 const el=document.getElementById('matchesList'); if(!el)return;
 if(error){el.innerHTML='<div class="empty card">Eşleşmeler alınamadı.</div>';return}
 const ids=(data||[]).map(m=>m.user_1===uid?m.user_2:m.user_1);
 if(!ids.length){el.innerHTML='<div class="empty card">Henüz eşleşme yok.</div>';return}
 const {data:people}=await supabase.from('profiles').select('*').in('id',ids);
 el.innerHTML=(people||[]).map(p=>`<div class="list-item"><div><strong>${esc(p.name||'Kullanıcı')}</strong><div class="muted">${esc(p.city||'')} · ${esc(p.country||'')}</div></div><button class="btn btn-dark" data-match-msg="${p.id}">Mesaj</button></div>`).join('');
 document.querySelectorAll('[data-match-msg]').forEach(b=>b.onclick=()=>openConversationByUser(b.dataset.matchMsg));
}

async function bindShell(){
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=async()=>{
   state.view=b.dataset.view;
   if(state.view==='discover') await loadProfiles();
   if(state.view==='messages') await loadConversations();
   render();
   if(state.view==='matches') loadMatches();
 });
 document.getElementById('logout').onclick=()=>supabase.auth.signOut();

 const search=document.getElementById('search'),cf=document.getElementById('countryFilter');
 const filter=()=>{document.querySelectorAll('.p-card').forEach(c=>{let q=(search?.value||'').toLowerCase(),country=cf?.value||'';let ok=(!q||(c.dataset.name.includes(q)||c.dataset.city.includes(q)))&&(!country||c.dataset.country===country);c.style.display=ok?'':'none'})};
 if(search)search.oninput=filter;if(cf)cf.onchange=filter;

 document.querySelectorAll('[data-like]').forEach(b=>b.onclick=async()=>{
   const {data,error}=await supabase.rpc('like_profile',{target_user:b.dataset.like});
   if(error) return toast('Beğeni gönderilemedi. SQL patch çalıştı mı?');
   b.textContent='♥ Beğenildi';
   toast(data?.matched?'Yeni eşleşme!':'Beğeni gönderildi');
 });

 document.querySelectorAll('[data-msg]').forEach(b=>b.onclick=()=>openConversationByUser(b.dataset.msg));

 document.querySelectorAll('[data-conv]').forEach(b=>b.onclick=async()=>{
   const c=state.conversations.find(x=>x.id===b.dataset.conv);
   state.selectedConversation=b.dataset.conv;
   state.selectedPartner=c?.partner||null;
   await loadMessages(state.selectedConversation);
   subscribeMessages(state.selectedConversation);
   render();
 });

 const chatForm=document.getElementById('chatForm');
 if(chatForm) chatForm.onsubmit=async e=>{
   e.preventDefault();
   const text=chatForm.message.value.trim();
   if(!text)return;
   chatForm.message.value='';
   const {error}=await supabase.from('messages').insert({conversation_id:state.selectedConversation,sender_id:state.user.id,message_text:text});
   if(error) toast('Mesaj gönderilemedi');
 };

 const pf=document.getElementById('profileForm');
 if(pf) pf.onsubmit=async e=>{
   e.preventDefault();const fd=new FormData(e.target);
   const updates={name:fd.get('name'),age:+fd.get('age'),city:fd.get('city'),country:fd.get('country'),language:fd.get('language'),job:fd.get('job'),bio:fd.get('bio')};
   const {error}=await supabase.from('profiles').update(updates).eq('id',state.user.id);
   if(error)return toast('Profil kaydedilemedi');
   await loadCurrentProfile();toast('Profil kaydedildi');
 };

 const photo=document.getElementById('photoInput');
 if(photo) photo.onchange=async e=>{
   const file=e.target.files?.[0];if(!file)return;
   if(file.size>5*1024*1024)return toast('Fotoğraf en fazla 5 MB olabilir');
   const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
   const path=`${state.user.id}/avatar.${ext}`;
   const {error:upErr}=await supabase.storage.from('avatars').upload(path,file,{upsert:true,contentType:file.type});
   if(upErr)return toast('Fotoğraf yüklenemedi');
   const {data}=supabase.storage.from('avatars').getPublicUrl(path);
   const url=data.publicUrl+'?v='+Date.now();
   const {error}=await supabase.from('profiles').update({avatar_url:url}).eq('id',state.user.id);
   if(error)return toast('Profil fotoğrafı kaydedilemedi');
   await loadCurrentProfile();toast('Fotoğraf yüklendi');
 };

 const report=document.getElementById('reportBtn');
 if(report)report.onclick=async()=>{
   const partner=state.selectedPartner||state.conversations.find(c=>c.id===state.selectedConversation)?.partner;
   const reason=prompt('Şikâyet nedeni:');if(!reason)return;
   const {error}=await supabase.from('reports').insert({reporter_id:state.user.id,reported_id:partner.id,reason});
   if(error)return toast('Şikâyet gönderilemedi');toast('Şikâyet gönderildi');
 };

 const block=document.getElementById('blockBtn');
 if(block)block.onclick=async()=>{
   const partner=state.selectedPartner||state.conversations.find(c=>c.id===state.selectedConversation)?.partner;
   if(!confirm(`${partner?.name||'Bu kullanıcı'} engellensin mi?`))return;
   const {error}=await supabase.from('blocks').insert({blocker_id:state.user.id,blocked_id:partner.id});
   if(error&&error.code!=='23505')return toast('Engelleme başarısız');
   toast('Kullanıcı engellendi');
 };

 if(state.view==='matches') loadMatches();
 setTimeout(()=>{const a=document.getElementById('chatarea');if(a)a.scrollTop=a.scrollHeight},0);
}

function render(){
 if(!state.locale){app.innerHTML=localeView();document.getElementById('localeForm').onsubmit=e=>{e.preventDefault();let fd=new FormData(e.target);state.locale={country:fd.get('country'),language:fd.get('language')};localStorage.setItem('nm_locale',JSON.stringify(state.locale));render()};return}
 if(!state.user){app.innerHTML=authView();bindAuth();return}
 app.innerHTML=shellView();bindShell();
}

function bindAuth(){
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.authTab=b.dataset.tab;state.authMessage='';render()});
 const login=document.getElementById('loginForm');
 if(login)login.onsubmit=async e=>{
   e.preventDefault();const fd=new FormData(e.target);
   const {error}=await supabase.auth.signInWithPassword({email:fd.get('email'),password:fd.get('password')});
   if(error){state.authMessage='HATA:'+error.message;render()}
 };
 const reg=document.getElementById('registerForm');
 if(reg)reg.onsubmit=async e=>{
   e.preventDefault();const fd=new FormData(e.target);
   const {data,error}=await supabase.auth.signUp({
     email:fd.get('email'),password:fd.get('password'),
     options:{data:{name:fd.get('name'),age:fd.get('age'),city:fd.get('city'),country:fd.get('country'),language:state.locale.language,gender:fd.get('gender'),looking_for:fd.get('looking_for')}}
   });
   if(error){state.authMessage='HATA:'+error.message;return render()}
   if(data.session){state.authMessage='Kayıt başarılı.'}
   else{state.authMessage='Kayıt başarılı. E-posta doğrulaması açıksa gelen kutundaki bağlantıya tıkla, sonra giriş yap.'}
   state.authTab='login';render();
 };
}

async function prepareLoggedIn(){
 await loadCurrentProfile();
 await loadProfiles();
 await loadConversations();
 if(state.conversations.length && !state.selectedConversation){
   state.selectedConversation=state.conversations[0].id;
   state.selectedPartner=state.conversations[0].partner;
   await loadMessages(state.selectedConversation);
 }
}

(async()=>{
 const {data:{session}}=await supabase.auth.getSession();
 state.session=session;state.user=session?.user||null;
 if(state.user)await prepareLoggedIn();
 render();
 supabase.auth.onAuthStateChange(async (_event,session)=>{
   state.session=session;state.user=session?.user||null;
   if(state.user)await prepareLoggedIn();
   else{state.profile=null;state.profiles=[];state.conversations=[];state.messages=[]}
   render();
 });
})();
