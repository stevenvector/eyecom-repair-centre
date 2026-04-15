
// ==============================================
//  CONFIG
// ==============================================
var SUPA_URL='https://educbtcexgflpaxvjhwa.supabase.co';
var SUPA_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkdWNidGNleGdmbHBheHZqaHdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwNjg2ODcsImV4cCI6MjA4NTY0NDY4N30._Kci3pHCk9uzI2YA6fLbCcAfb9srY4yESIF93b2DnXM';
var sb=supabase.createClient(SUPA_URL,SUPA_KEY);
var CU=null,editJid=null,stJid=null,sessJid=null,sessStart=null,sessInterval=null,syncDebounce=null,tzInterval=null;
var allUsers=[],allJobs=[],allLogs=[],allReqs=[],rtChannels=[];
var fpEmail=''; // stores email during reset flow

// ==============================================
//  INIT
// ==============================================
(async function init(){
  try{
    var{error}=await sb.from('rc_users').select('id').limit(1);
    var el=document.getElementById('conn-status');
    if(error)throw error;
    el.className='lconn ok';el.textContent='  Connected to Eyecom database';
  }catch(e){
    var el=document.getElementById('conn-status');
    el.className='lconn err';el.textContent='  Database connection failed';
  }
})();

// ==============================================
//  AUTH
// ==============================================
async function doLogin(){
  var u=document.getElementById('lu').value.trim(),p=document.getElementById('lpw').value;
  if(!u||!p){showErr('Please enter username and password.');return;}
  var btn=document.getElementById('login-btn');btn.disabled=true;btn.innerHTML='<span class="spin"></span>Authenticating...';
  try{
    var{data,error}=await sb.from('rc_users').select('*').eq('username',u).eq('password_hash',p).eq('status','active').single();
    if(error||!data){showErr('Invalid credentials. Please try again.');return;}
    CU=data;
    document.getElementById('lp').style.display='none';
    document.getElementById('app').style.display='block';
    await setupUI();
  }catch(e){showErr('Connection error. Please try again.');}
  finally{btn.disabled=false;btn.textContent='ACCESS SYSTEM';}
}
function showErr(m){var e=document.getElementById('lerr');e.textContent=m;e.style.display='block';}
async function doLogout(){
  if(sessJid)await abandonSession();
  if(tzInterval)clearInterval(tzInterval);
  rtChannels.forEach(function(c){sb.removeChannel(c);});rtChannels=[];
  CU=null;allUsers=[];allJobs=[];allLogs=[];allReqs=[];
  document.getElementById('app').style.display='none';
  document.getElementById('lp').style.display='flex';
  document.getElementById('lu').value='';document.getElementById('lpw').value='';
  document.getElementById('lerr').style.display='none';
  // reset forgot panel
  document.getElementById('forgot-panel').style.display='none';
  document.getElementById('login-form').style.display='block';
}

// ==============================================
//  FORGOT PASSWORD FLOW
// ==============================================
function toggleForgot(){
  var fp=document.getElementById('forgot-panel');
  var lf=document.getElementById('login-form');
  var showing=fp.style.display==='block';
  fp.style.display=showing?'none':'block';
  lf.style.display=showing?'block':'none';
  document.getElementById('lerr').style.display='none';
}

async function requestReset(){
  var email=document.getElementById('fp-email').value.trim();
  var err=document.getElementById('fp-err1');var ok=document.getElementById('fp-ok1');
  err.style.display='none';ok.style.display='none';
  if(!email){err.textContent='Please enter your email address.';err.style.display='block';return;}

  // Find user by email
  var{data:user}=await sb.from('rc_users').select('id,name,email').eq('email',email).eq('status','active').single();
  // Always show success message (security: don't reveal if email exists)
  if(user){
    // Generate 6-digit token
    var token=String(Math.floor(100000+Math.random()*900000));
    var exp=new Date(Date.now()+3600000).toISOString();
    // Store reset token
    await sb.from('rc_password_resets').insert({user_id:user.id,token:token,expires_at:exp});
    // In production: send email. For now, show token in a dev notice
    fpEmail=email;
    // Show token in success message for demo (replace with real email in prod)
    ok.textContent='Reset code sent! For testing, your code is: '+token;
    ok.style.display='block';
  } else {
    ok.textContent='If this email is registered, a reset code has been sent.';
    ok.style.display='block';
  }
  // Move to step 2 after short delay
  setTimeout(function(){
    document.getElementById('fp-step1').classList.remove('active');
    document.getElementById('fp-step2').classList.add('active');
  },1800);
}

async function confirmReset(){
  var token=document.getElementById('fp-token').value.trim();
  var newpw=document.getElementById('fp-newpw').value;
  var confirmpw=document.getElementById('fp-confirmpw').value;
  var err=document.getElementById('fp-err2');var ok=document.getElementById('fp-ok2');
  err.style.display='none';ok.style.display='none';
  if(!token||token.length!==6){err.textContent='Please enter the 6-digit code.';err.style.display='block';return;}
  if(!newpw||newpw.length<6){err.textContent='Password must be at least 6 characters.';err.style.display='block';return;}
  if(newpw!==confirmpw){err.textContent='Passwords do not match.';err.style.display='block';return;}

  // Validate token
  var{data:reset}=await sb.from('rc_password_resets').select('*').eq('token',token).eq('used',false).single();
  if(!reset||new Date(reset.expires_at)<new Date()){
    err.textContent='Invalid or expired reset code. Please try again.';err.style.display='block';return;
  }
  // Update password
  await sb.from('rc_users').update({password_hash:newpw}).eq('id',reset.user_id);
  await sb.from('rc_password_resets').update({used:true}).eq('id',reset.id);
  ok.textContent='Password updated successfully! You can now log in.';ok.style.display='block';
  setTimeout(function(){toggleForgot();document.getElementById('fp-step2').classList.remove('active');document.getElementById('fp-step1').classList.add('active');document.getElementById('fp-token').value='';document.getElementById('fp-newpw').value='';document.getElementById('fp-confirmpw').value='';document.getElementById('fp-email').value='';},2000);
}

// ==============================================
//  SETUP
// ==============================================
async function setupUI(){
  var init=CU.initials||(CU.name.split(' ').map(function(w){return w[0];}).join('').slice(0,2).toUpperCase());
  document.getElementById('savat').textContent=init;
  document.getElementById('sname').textContent=CU.name;
  document.getElementById('srole').textContent=CU.role;
  document.getElementById('dgreet').textContent='Welcome, '+CU.name.split(' ')[0];
  var ca=CU.is_admin||CU.is_senior;
  document.querySelectorAll('.ao').forEach(function(el){el.style.display=ca?'':'none';});
  document.querySelectorAll('.ao-assign').forEach(function(el){el.style.display=ca?'':'none';});
  await Promise.all([loadUsers(),loadJobs(),loadLogs(),loadReqs()]);
  setupRealtime();renderDash();prepReports();
}
async function loadUsers(){var{data}=await sb.from('rc_users').select('*').order('name');allUsers=data||[];var ru=document.getElementById('rep-user');if(ru){ru.innerHTML='<option value="">All Technicians</option>'+allUsers.filter(function(u){return!u.is_admin;}).map(function(u){return'<option value="'+u.id+'">'+u.name+'</option>';}).join('');}}
async function loadJobs(){var{data}=await sb.from('rc_jobs').select('*').order('created_at',{ascending:false});allJobs=data||[];}
async function loadLogs(){var{data}=await sb.from('rc_work_logs').select('*').order('created_at',{ascending:false});allLogs=data||[];}
async function loadReqs(){var{data}=await sb.from('rc_requests').select('*').order('created_at',{ascending:false});allReqs=data||[];updateNBReqs();}
async function loadSessions(){var{data}=await sb.from('rc_work_sessions').select('*');return data||[];}

function setupRealtime(){
  var sc2=sb.channel('rc_ws_ch').on('postgres_changes',{event:'*',schema:'public',table:'rc_work_sessions'},async function(){await loadJobs();refreshActivePage();refreshAllTables();updateActiveNB();if(sessJid)refreshSessOthers();}).subscribe();
  var jc=sb.channel('rc_j_ch').on('postgres_changes',{event:'*',schema:'public',table:'rc_jobs'},async function(){await loadJobs();refreshAllTables();}).subscribe();
  var lc = sb.channel('rc_l_ch')
    .on('postgres_changes',{event:'*',schema:'public',table:'rc_work_logs'}, async function(){
      await loadLogs(); renderWLPage();
    }).subscribe();

  // Damage logs - update damage page if open
  var dc = sb.channel('rc_dmg_ch')
    .on('postgres_changes',{event:'*',schema:'public',table:'rc_damage_logs'}, async function(){
      await loadDamageLogs();
      if (document.getElementById('page-damage').classList.contains('active')) renderDamagePage();
    }).subscribe();

  // Stock changes - update stock page if open
  var stc = sb.channel('rc_stk_ch')
    .on('postgres_changes',{event:'*',schema:'public',table:'rc_stock'}, async function(){
      await loadStock();
      if (document.getElementById('page-stock').classList.contains('active')) renderStockPage();
    }).subscribe();

  // Requests - update notification badge
  var rqc = sb.channel('rc_rq_ch')
    .on('postgres_changes',{event:'*',schema:'public',table:'rc_requests'}, async function(){
      await loadReqs(); updateNBReqs();
    }).subscribe();

  // Programming records - update programming page if open
  var pgc = sb.channel('rc_pg_ch')
    .on('postgres_changes',{event:'*',schema:'public',table:'rc_programming'}, async function(){
      await loadProgramming();
      if (document.getElementById('page-programming').classList.contains('active')) renderProgrammingPage();
    }).subscribe();

  rtChannels = [sc2, jc, lc, dc, stc, rqc, pgc];
}

// ==============================================
//  SETTINGS
// ==============================================
var TIMEZONES={
  Africa:['Africa/Abidjan','Africa/Accra','Africa/Addis_Ababa','Africa/Algiers','Africa/Cairo','Africa/Casablanca','Africa/Johannesburg','Africa/Lagos','Africa/Nairobi','Africa/Tunis'],
  America:['America/Anchorage','America/Argentina/Buenos_Aires','America/Bogota','America/Chicago','America/Denver','America/Los_Angeles','America/Mexico_City','America/New_York','America/Sao_Paulo','America/Toronto','America/Vancouver'],
  Asia:['Asia/Bangkok','Asia/Colombo','Asia/Dubai','Asia/Hong_Kong','Asia/Jakarta','Asia/Karachi','Asia/Kolkata','Asia/Kuala_Lumpur','Asia/Riyadh','Asia/Seoul','Asia/Shanghai','Asia/Singapore','Asia/Taipei','Asia/Tokyo'],
  Atlantic:['Atlantic/Azores','Atlantic/Cape_Verde','Atlantic/Reykjavik'],
  Australia:['Australia/Adelaide','Australia/Brisbane','Australia/Darwin','Australia/Melbourne','Australia/Perth','Australia/Sydney','Pacific/Auckland','Pacific/Fiji'],
  Europe:['Europe/Amsterdam','Europe/Athens','Europe/Berlin','Europe/Brussels','Europe/Budapest','Europe/Dublin','Europe/Helsinki','Europe/Istanbul','Europe/Lisbon','Europe/London','Europe/Madrid','Europe/Moscow','Europe/Paris','Europe/Rome','Europe/Stockholm','Europe/Warsaw','Europe/Zurich'],
  Indian:['Indian/Maldives','Indian/Mauritius','Indian/Reunion'],
  Pacific:['Pacific/Apia','Pacific/Honolulu','Pacific/Noumea','Pacific/Tahiti'],
  UTC:['UTC']
};

function showSettingsPanel(name){
  document.querySelectorAll('.settings-panel').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.snav-item').forEach(function(n){n.classList.remove('active');});
  document.getElementById('sp-'+name).classList.add('active');
  document.querySelector('.snav-item[onclick*="\''+name+'\'"]').classList.add('active');
  if(name==='profile')loadProfilePanel();
  if(name==='email')loadEmailPanel();
  if(name==='region')loadRegionPanel();
}

function loadProfilePanel(){
  if(!CU)return;
  document.getElementById('settings-avatar').textContent=CU.initials||(CU.name.split(' ').map(function(w){return w[0];}).join('').slice(0,2).toUpperCase());
  document.getElementById('settings-name-display').textContent=CU.name;
  document.getElementById('settings-role-display').textContent=CU.role;
  document.getElementById('settings-username-display').textContent=CU.username;
  document.getElementById('set-name').value=CU.name;
  document.getElementById('set-username').value=CU.username;
  document.getElementById('set-role').value=CU.role;
}

async function saveProfile(){
  var name=document.getElementById('set-name').value.trim();
  var username=document.getElementById('set-username').value.trim();
  if(!name||!username){toast('Name and username are required.','error');return;}
  // Check username uniqueness (excluding self)
  var{data:existing}=await sb.from('rc_users').select('id').eq('username',username).neq('id',CU.id);
  if(existing&&existing.length){toast('Username already taken.','error');return;}
  var init=name.split(' ').map(function(w){return w[0];}).join('').toUpperCase().slice(0,2);
  var{error}=await sb.from('rc_users').update({name:name,username:username,initials:init}).eq('id',CU.id);
  if(error){toast('Error: '+error.message,'error');return;}
  CU.name=name;CU.username=username;CU.initials=init;
  document.getElementById('savat').textContent=init;
  document.getElementById('sname').textContent=name;
  loadProfilePanel();
  await loadUsers();
  toast('Profile updated!','success');
}

function loadEmailPanel(){
  if(!CU)return;
  document.getElementById('set-email').value=CU.email||'';
  var row=document.getElementById('email-status-row');
  if(CU.email){
    row.innerHTML='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="font-size:13px;color:var(--tp)">'+CU.email+'</span>'+
      (CU.email_verified?
        '<span class="verified-badge">  Verified</span>':
        '<span class="unverified-badge">  Not Verified</span>')+
      '</div>';
    document.getElementById('verify-section').style.display=CU.email_verified?'none':'block';
    document.getElementById('send-verify-btn').style.display='block';
  } else {
    row.innerHTML='<div style="font-size:12px;color:var(--tm)">No email address added yet. Add one to enable password resets.</div>';
    document.getElementById('verify-section').style.display='none';
  }
}

async function saveEmail(){
  var email=document.getElementById('set-email').value.trim();
  if(!email||!email.includes('@')){toast('Please enter a valid email address.','error');return;}
  // Check uniqueness
  var{data:existing}=await sb.from('rc_users').select('id').eq('email',email).neq('id',CU.id);
  if(existing&&existing.length){toast('This email is already used by another account.','error');return;}
  var{error}=await sb.from('rc_users').update({email:email,email_verified:false}).eq('id',CU.id);
  if(error){toast('Error: '+error.message,'error');return;}
  CU.email=email;CU.email_verified=false;
  loadEmailPanel();
  toast('Email saved. Please verify it.','success');
}

async function sendVerification(){
  if(!CU.email){toast('Please add an email address first.','error');return;}
  var token=String(Math.floor(100000+Math.random()*900000));
  var exp=new Date(Date.now()+86400000).toISOString();
  await sb.from('rc_email_verifications').insert({user_id:CU.id,email:CU.email,token:token,expires_at:exp});
  // In production: send email. Show token for demo.
  toast('Verification code sent! (Demo code: '+token+')','info');
  document.getElementById('verify-code-input').style.display='block';
  document.getElementById('send-verify-btn').style.display='none';
}

async function confirmVerification(){
  var token=document.getElementById('set-verify-token').value.trim();
  if(!token||token.length!==6){toast('Enter the 6-digit verification code.','error');return;}
  var{data:rec}=await sb.from('rc_email_verifications').select('*').eq('token',token).eq('user_id',CU.id).eq('used',false).single();
  if(!rec||new Date(rec.expires_at)<new Date()){toast('Invalid or expired code. Request a new one.','error');return;}
  await sb.from('rc_users').update({email_verified:true,email:rec.email}).eq('id',CU.id);
  await sb.from('rc_email_verifications').update({used:true}).eq('id',rec.id);
  CU.email_verified=true;
  loadEmailPanel();
  toast('Email verified successfully!','success');
}

async function changePassword(){
  var cur=document.getElementById('set-cur-pw').value;
  var newpw=document.getElementById('set-new-pw').value;
  var conf=document.getElementById('set-confirm-pw').value;
  if(!cur||!newpw||!conf){toast('Please fill in all password fields.','error');return;}
  if(cur!==CU.password_hash){toast('Current password is incorrect.','error');return;}
  if(newpw.length<6){toast('New password must be at least 6 characters.','error');return;}
  if(newpw!==conf){toast('New passwords do not match.','error');return;}
  var{error}=await sb.from('rc_users').update({password_hash:newpw}).eq('id',CU.id);
  if(error){toast('Error: '+error.message,'error');return;}
  CU.password_hash=newpw;
  document.getElementById('set-cur-pw').value='';
  document.getElementById('set-new-pw').value='';
  document.getElementById('set-confirm-pw').value='';
  document.getElementById('set-pw-strength').className='password-strength';
  toast('Password updated successfully!','success');
}

function checkPwStrength(inputId,barId){
  var pw=document.getElementById(inputId).value;
  var bar=document.getElementById(barId);
  if(!pw){bar.className='password-strength';return;}
  var score=0;
  if(pw.length>=6)score++;
  if(pw.length>=10)score++;
  if(/[A-Z]/.test(pw)&&/[0-9]/.test(pw))score++;
  if(score===1)bar.className='password-strength pw-weak';
  else if(score===2)bar.className='password-strength pw-medium';
  else bar.className='password-strength pw-strong';
}

function loadRegionPanel(){
  if(!CU)return;
  // Determine region prefix from timezone
  var tz=CU.timezone||'Africa/Johannesburg';
  var region=tz.split('/')[0];
  var regionMap={'Africa':'Africa','America':'America','Asia':'Asia','Atlantic':'Atlantic','Australia':'Australia','Europe':'Europe','Indian':'Indian','Pacific':'Pacific','UTC':'UTC'};
  var reg=regionMap[region]||'Africa';
  document.getElementById('set-region').value=reg;
  updateTzOptions();
  document.getElementById('set-timezone').value=tz;
  startTzClock();
}

function updateTzOptions(){
  var reg=document.getElementById('set-region').value;
  var tzs=TIMEZONES[reg]||['UTC'];
  var sel=document.getElementById('set-timezone');
  sel.innerHTML=tzs.map(function(t){return'<option value="'+t+'">'+t.replace(/_/g,' ')+'</option>';}).join('');
  startTzClock();
}

function startTzClock(){
  if(tzInterval)clearInterval(tzInterval);
  tzInterval=setInterval(updateTzDisplay,1000);
  updateTzDisplay();
}

function updateTzDisplay(){
  var tz=document.getElementById('set-timezone');
  if(!tz)return;
  var tzVal=tz.value;
  try{
    var now=new Date();
    var timeStr=now.toLocaleTimeString('en-ZA',{timeZone:tzVal,hour:'2-digit',minute:'2-digit',second:'2-digit'});
    var dateStr=now.toLocaleDateString('en-ZA',{timeZone:tzVal,weekday:'short',year:'numeric',month:'short',day:'numeric'});
    var el=document.getElementById('tz-current-time');
    var lbl=document.getElementById('tz-label');
    if(el)el.textContent=timeStr;
    if(lbl)lbl.textContent='- '+dateStr+' ('+tzVal.replace(/_/g,' ')+')';
  }catch(e){}
}

async function saveRegion(){
  var tz=document.getElementById('set-timezone').value;
  var reg=document.getElementById('set-region').value;
  var{error}=await sb.from('rc_users').update({timezone:tz,region:reg}).eq('id',CU.id);
  if(error){toast('Error: '+error.message,'error');return;}
  CU.timezone=tz;CU.region=reg;
  toast('Region and timezone saved!','success');
}

// ==============================================
//  NAVIGATION
// ==============================================
function toggleSB(){document.getElementById('sidebar').classList.toggle('open');document.getElementById('sov').classList.toggle('open');}
function closeSB(){document.getElementById('sidebar').classList.remove('open');document.getElementById('sov').classList.remove('open');}
function showPage(n){
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.ni').forEach(function(ni){ni.classList.remove('active');});
  document.getElementById('page-'+n).classList.add('active');
  var ni=document.querySelector('.ni[onclick*="\''+n+'\'"]');if(ni)ni.classList.add('active');
  if(n==='dashboard')renderDash();
  if(n==='jobs')renderAllJobs();
  if(n==='active')refreshActivePage();
  if(n==='worklog')renderWLPage();
  if(n==='users')renderUsers();
  if(n==='requests')renderReqs();
  if(n==='settings'){loadProfilePanel();}
}
document.querySelectorAll('.mover').forEach(function(ov){ov.addEventListener('click',function(e){if(e.target===ov)ov.classList.remove('open');});});
document.getElementById('lpw').addEventListener('keydown',function(e){if(e.key==='Enter')doLogin();});
function om(id){document.getElementById(id).classList.add('open');}
function cm(id){document.getElementById(id).classList.remove('open');}

// ==============================================
//  HELPERS
// ==============================================
function userName(id){var u=allUsers.find(function(x){return x.id===id;});return u?u.name:'?';}
function userInit(id){var u=allUsers.find(function(x){return x.id===id;});return u?(u.initials||u.name.slice(0,2).toUpperCase()):'?';}
function sc(s){return'b-'+s.toLowerCase().replace(/ /g,'-');}
function pc(p){return'p-'+p.toLowerCase();}
function fmtDur(s){var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60;return pad(h)+':'+pad(m)+':'+pad(ss);}
function pad(n){return String(n).padStart(2,'0');}

// ==============================================
//  DASHBOARD
// ==============================================
async function renderDash(){
  document.getElementById('sgg').innerHTML='<div class="sc blue"><div class="slb">Total Jobs</div><div class="sv">'+allJobs.length+'</div></div><div class="sc orange"><div class="slb">In Progress</div><div class="sv">'+allJobs.filter(function(j){return j.status==='In Progress';}).length+'</div></div><div class="sc green"><div class="slb">Completed</div><div class="sv">'+allJobs.filter(function(j){return j.status==='Completed';}).length+'</div></div><div class="sc red"><div class="slb">Urgent</div><div class="sv">'+allJobs.filter(function(j){return j.priority==='Urgent';}).length+'</div></div>';
  document.getElementById('jstitle').textContent=CU.is_admin?'All Jobs Overview':'My Jobs';
  renderJobsTable();
}
function refreshAllTables(){if(document.getElementById('page-dashboard').classList.contains('active'))renderJobsTable();if(document.getElementById('page-jobs').classList.contains('active'))renderAllJobs();}
async function getSessionsMap(){var sessions=await loadSessions();var map={};sessions.forEach(function(s){if(!map[s.job_id])map[s.job_id]=[];map[s.job_id].push(s);});return map;}
function activeTechsHtml(sessions){if(!sessions||!sessions.length)return'<span style="color:var(--tm);font-size:12px">-</span>';return sessions.map(function(s){return'<span class="chip" style="background:rgba(0,255,136,.1);color:var(--cg)"><span class="ldot2"></span>'+userName(s.user_id).split(' ')[0]+'</span>';}).join(' ');}
async function renderJobsTable(){var sf=document.getElementById('dsf').value,pf=document.getElementById('dpf').value,sessMap=await getSessionsMap();var f=allJobs;if(!CU.is_admin&&!CU.is_senior)f=f.filter(function(j){return j.assigned_to===CU.id||(sessMap[j.id]||[]).some(function(s){return s.user_id===CU.id;});});if(sf)f=f.filter(function(j){return j.status===sf;});if(pf)f=f.filter(function(j){return j.priority===pf;});document.getElementById('jtb').innerHTML=jobRows(f,sessMap,false);}
async function renderAllJobs(){var s=(document.getElementById('jsearch').value||'').toLowerCase(),sf=document.getElementById('jasf').value,pf=document.getElementById('japf').value,sessMap=await getSessionsMap();var f=allJobs;if(s)f=f.filter(function(j){return j.job_name.toLowerCase().includes(s)||j.client.toLowerCase().includes(s)||j.job_number.toLowerCase().includes(s)||(j.batch||'').toLowerCase().includes(s);});if(sf)f=f.filter(function(j){return j.status===sf;});if(pf)f=f.filter(function(j){return j.priority===pf;});document.getElementById('ajtb').innerHTML=jobRows(f,sessMap,true);}
function jobRows(arr,sessMap,showDate){
  if(!arr.length)return'<tr><td colspan="12"><div class="empty"><div class="eico"> </div><p class="etxt">No jobs found</p></div></td></tr>';
  return arr.map(function(j){
    var sessions=sessMap[j.id]||[],mySession=sessions.find(function(s){return s.user_id===CU.id;}),ca=CU.is_admin||CU.is_senior,ce=ca||j.assigned_to===CU.id;
    var sc2=sc(j.status),pc2=pc(j.priority);
    var acts='<button class="btn bout bsm" onclick="viewJob(\''+j.id+'\')">  View</button>';
    if(ce)acts+=' <button class="btn bout bsm" onclick="openEdit(\''+j.id+'\')">  Edit</button>';
    acts+=' <button class="btn bwarn bsm" onclick="openStatus(\''+j.id+'\')">  Status</button>';
    if(!mySession&&j.status!=='Completed'&&j.status!=='Cancelled')acts+=' <button class="btn bsuccess bsm" onclick="startSession(\''+j.id+'\')">  Start</button>';
    else if(mySession)acts+=' <button class="btn binfo bsm" onclick="reopenSession(\''+j.id+'\',\''+mySession.id+'\')">  Resume</button>';
    if(CU.is_admin)acts+=' <button class="btn bdanger bsm" onclick="delJob(\''+j.id+'\')"> </button>';
    var dc=showDate?'<td style="font-size:12px;color:var(--tm)">'+(j.job_date?j.job_date.slice(0,10):'-')+'</td>':'';
    var bc2=showDate?'<td><code style="font-size:11px;background:rgba(0,212,255,.07);padding:2px 5px;border-radius:4px">'+(j.batch||'-')+'</code></td>':'';
    return'<tr><td><span style="font-family:Rajdhani,sans-serif;color:var(--c1);font-weight:600">'+j.job_number+'</span></td><td><span style="font-weight:500">'+j.job_name+'</span></td><td style="color:var(--tm)">'+j.client+'</td>'+bc2+'<td><span style="background:rgba(168,85,247,.1);color:var(--cp);padding:2px 7px;border-radius:4px;font-size:12px;font-weight:600">'+(j.pitch||'-')+'</span></td><td style="text-align:center">'+j.qty+'</td><td><span class="pb '+pc2+'">'+j.priority+'</span></td><td><span class="bdg '+sc2+'"><span class="bdot"></span>'+j.status+'</span></td><td>'+activeTechsHtml(sessions)+'</td>'+dc+'<td><div class="abtns">'+acts+'</div></td></tr>';
  }).join('');
}

// ==============================================
//  VIEW JOB
// ==============================================
async function viewJob(id){
  var j=allJobs.find(function(x){return x.id===id;});if(!j)return;
  var sessions=await loadSessions(),jSess=sessions.filter(function(s){return s.job_id===id;}),jLogs=allLogs.filter(function(wl){return wl.job_id===id;}),mySession=jSess.find(function(s){return s.user_id===CU.id;}),ce=CU.is_admin||CU.is_senior||j.assigned_to===CU.id;
  var sc2=sc(j.status),pc2=pc(j.priority);
  var wlHtml=jLogs.length?jLogs.map(function(wl){var dur='-';if(wl.start_time&&wl.end_time)dur=fmtDur(Math.floor((new Date(wl.end_time)-new Date(wl.start_time))/1000));return'<div class="wle"><div class="wleh"><span class="wlu">'+userName(wl.user_id)+'</span><span class="wlt">'+(wl.start_time?wl.start_time.slice(0,16).replace('T',' '):'')+' -> '+(wl.end_time?wl.end_time.slice(0,16).replace('T',' '):'')+' ('+dur+')</span></div><div class="wlstats"><div class="wlstat"><div class="wlsv" style="color:var(--cy)">'+wl.lt3+'</div><div class="wlsl">&lt;3 Px</div></div><div class="wlstat"><div class="wlsv" style="color:var(--cr)">'+wl.gt3+'</div><div class="wlsl">&gt;3 Px</div></div><div class="wlstat"><div class="wlsv" style="color:var(--c2)">'+wl.track+'</div><div class="wlsl">Track</div></div><div class="wlstat"><div class="wlsv" style="color:var(--cp)">'+wl.chip+'</div><div class="wlsl">Chip</div></div><div class="wlstat"><div class="wlsv" style="color:var(--cr)">'+wl.ber+'</div><div class="wlsl">BER</div></div><div class="wlstat"><div class="wlsv" style="color:var(--cg)">'+wl.qty+'</div><div class="wlsl">Total Qty</div></div></div>'+(wl.notes?'<div style="font-size:12px;color:var(--tm)">'+wl.notes+'</div>':'')+' </div>';}).join(''):'<div class="empty"><div class="eico"> </div><p class="etxt">No work logs yet</p></div>';
  var activeHtml=jSess.length?jSess.map(function(s){var elapsed=fmtDur(Math.floor((Date.now()-new Date(s.start_time).getTime())/1000));return'<div class="session-card"><div class="session-header"><div style="display:flex;align-items:center;gap:9px"><div class="av avlg">'+userInit(s.user_id)+'</div><div><div style="font-size:14px;font-weight:600">'+userName(s.user_id)+'</div><div style="font-size:12px;color:var(--tm)">'+s.start_time.slice(0,16).replace('T',' ')+'</div></div></div><span><span class="ldot2"></span><span style="font-size:12px;color:var(--cg)">Live - '+elapsed+'</span></span></div><div class="sess-grid"><div class="sfield"><div class="sfval">'+s.lt3+'</div><div class="sflbl">&lt;3 Px</div></div><div class="sfield"><div class="sfval" style="color:var(--cr)">'+s.gt3+'</div><div class="sflbl">&gt;3 Px</div></div><div class="sfield"><div class="sfval" style="color:var(--c2)">'+s.track+'</div><div class="sflbl">Track</div></div><div class="sfield"><div class="sfval" style="color:var(--cp)">'+s.chip+'</div><div class="sflbl">Chip</div></div><div class="sfield"><div class="sfval" style="color:var(--cr)">'+s.ber+'</div><div class="sflbl">BER</div></div><div class="sfield"><div class="sfval" style="color:var(--cg)">'+s.qty+'</div><div class="sflbl">Qty</div></div><div class="sfield"><div class="sfval" style="color:var(--c1)">'+(s.mod_tested||0)+'</div><div class="sflbl">Tested</div></div><div class="sfield"><div class="sfval" style="color:var(--cg)">'+(s.mod_passed||0)+'</div><div class="sflbl">Passed</div></div></div>'+(s.notes?'<div style="font-size:12px;color:var(--tm)">'+s.notes+'</div>':'')+' </div>';}).join(''):'<div class="empty"><div class="eico"> </div><p class="etxt">No active sessions</p></div>';
  var acts='';if(ce)acts+='<button class="btn bout" onclick="cm(\'m-view\');openEdit(\''+j.id+'\')">  Edit</button>';acts+='<button class="btn bwarn" onclick="cm(\'m-view\');openStatus(\''+j.id+'\')">  Status</button>';if(!mySession&&j.status!=='Completed'&&j.status!=='Cancelled')acts+='<button class="btn bsuccess" onclick="cm(\'m-view\');startSession(\''+j.id+'\')">  Start Work</button>';else if(mySession)acts+='<button class="btn binfo" onclick="cm(\'m-view\');reopenSession(\''+j.id+'\',\''+mySession.id+'\')">  Resume</button>';if(CU.is_admin)acts+='<button class="btn bdanger" onclick="cm(\'m-view\');delJob(\''+j.id+'\')">  Delete</button>';
  document.getElementById('vjttl').textContent=j.job_number+' - '+j.job_name;
  document.getElementById('vjcont').innerHTML='<div class="jdtabs"><div class="jdtab active" id="vt-d" onclick="vTab(\'d\')">Details</div><div class="jdtab" id="vt-w" onclick="vTab(\'w\')">Work Logs ('+jLogs.length+')</div><div class="jdtab" id="vt-a" onclick="vTab(\'a\')">Active Now ('+jSess.length+')</div></div><div id="vtd-d"><div class="drow"><div class="dl"><div class="dlb">Client</div><div class="dlv">'+j.client+'</div></div><div class="dl"><div class="dlb">Batch</div><div class="dlv"><code style="background:rgba(0,212,255,.07);padding:2px 6px;border-radius:4px;font-size:12px">'+(j.batch||'-')+'</code></div></div><div class="dl"><div class="dlb">Pitch</div><div class="dlv" style="color:var(--cp)">'+(j.pitch||'-')+'</div></div><div class="dl"><div class="dlb">Qty</div><div class="dlv">'+j.qty+' units</div></div><div class="dl"><div class="dlb">Priority</div><div class="dlv"><span class="pb '+pc2+'">'+j.priority+'</span></div></div><div class="dl"><div class="dlb">Status</div><div class="dlv"><span class="bdg '+sc2+'"><span class="bdot"></span>'+j.status+'</span></div></div><div class="dl"><div class="dlb">Assigned To</div><div class="dlv">'+(j.assigned_to?'<span class="chip">  '+userName(j.assigned_to)+'</span>':'<span style="color:var(--tm)">Unassigned</span>')+'</div></div><div class="dl"><div class="dlb">Date</div><div class="dlv">'+(j.job_date?j.job_date.slice(0,10):'-')+'</div></div><div class="dl"><div class="dlb">Spares</div><div class="dlv">'+(j.spares||'-')+'</div></div>'+(j.files&&j.files.length?'<div class="dl"><div class="dlb">Files</div><div class="dlv" style="font-size:12px;color:var(--tm)">'+j.files.join(', ')+'</div></div>':'')+'</div>'+(j.notes?'<div class="dnotes"><div class="dnlb">Notes</div><div class="dnv">'+j.notes+'</div></div>':'')+' </div><div id="vtd-w" style="display:none">'+wlHtml+'</div><div id="vtd-a" style="display:none">'+activeHtml+'</div><div class="jdact">'+acts+'</div>';
  om('m-view');
}
function vTab(t){document.querySelectorAll('.jdtab').forEach(function(el){el.classList.remove('active');});document.getElementById('vt-'+t).classList.add('active');['d','w','a'].forEach(function(x){var el=document.getElementById('vtd-'+x);if(el)el.style.display=x===t?'':'none';});}

// ==============================================
//  WORK SESSIONS
// ==============================================
async function startSession(jobId){var j=allJobs.find(function(x){return x.id===jobId;});if(!j)return;var now=new Date().toISOString();var{data,error}=await sb.from('rc_work_sessions').upsert({job_id:jobId,user_id:CU.id,start_time:now,lt3:0,gt3:0,track:0,chip:0,ber:0,qty:0,mod_tested:0,mod_passed:0,notes:''},{onConflict:'job_id,user_id'}).select().single();if(error){toast('Could not start session: '+error.message,'error');return;}if(j.status==='Pending'||j.status==='On Hold'){await sb.from('rc_jobs').update({status:'In Progress'}).eq('id',jobId);await loadJobs();}sessJid=jobId;sessStart=new Date(data.start_time);openSessionModal(j,data);toast('Session started on '+j.job_number,'success');}
async function reopenSession(jobId,sessId){var j=allJobs.find(function(x){return x.id===jobId;});if(!j)return;var{data}=await sb.from('rc_work_sessions').select('*').eq('id',sessId).single();if(!data){await startSession(jobId);return;}sessJid=jobId;sessStart=new Date(data.start_time);openSessionModal(j,data);}
function openSessionModal(j,sess){document.getElementById('sess-ttl').textContent=j.job_number+' - '+j.job_name;document.getElementById('sess-sub').textContent='Batch: '+(j.batch||'-')+' | Pitch: '+(j.pitch||'-')+' | Client: '+j.client;document.getElementById('sess-start-disp').textContent=sessStart.toISOString().slice(0,16).replace('T',' ');document.getElementById('wl-lt3').value=sess.lt3||'';document.getElementById('wl-gt3').value=sess.gt3||'';document.getElementById('wl-track').value=sess.track||'';document.getElementById('wl-chip').value=sess.chip||'';document.getElementById('wl-ber').value=sess.ber||'';document.getElementById('wl-mod-tested').value=sess.mod_tested||'';document.getElementById('wl-mod-passed').value=sess.mod_passed||'';document.getElementById('wl-notes').value=sess.notes||'';updateQtySum();om('m-session');if(sessInterval)clearInterval(sessInterval);sessInterval=setInterval(function(){var el=document.getElementById('sess-timer');if(el&&sessStart)el.textContent=fmtDur(Math.floor((Date.now()-sessStart.getTime())/1000));refreshSessOthers();},3000);refreshSessOthers();}
function updateQtySum(){var lt=parseInt(document.getElementById('wl-lt3').value)||0,gt=parseInt(document.getElementById('wl-gt3').value)||0,tr=parseInt(document.getElementById('wl-track').value)||0,ch=parseInt(document.getElementById('wl-chip').value)||0;document.getElementById('wl-qty').value=lt+gt+tr+ch;}
function syncSession(){updateQtySum();clearTimeout(syncDebounce);syncDebounce=setTimeout(async function(){if(!sessJid)return;var lt=parseInt(document.getElementById('wl-lt3').value)||0,gt=parseInt(document.getElementById('wl-gt3').value)||0,tr=parseInt(document.getElementById('wl-track').value)||0;var ch=parseInt(document.getElementById('wl-chip').value)||0;await sb.from('rc_work_sessions').update({lt3:lt,gt3:gt,track:tr,chip:ch,ber:parseInt(document.getElementById('wl-ber').value)||0,qty:lt+gt+tr+ch,mod_tested:parseInt(document.getElementById('wl-mod-tested').value)||0,mod_passed:parseInt(document.getElementById('wl-mod-passed').value)||0,notes:document.getElementById('wl-notes').value}).eq('job_id',sessJid).eq('user_id',CU.id);},800);}
async function refreshSessOthers(){if(!sessJid)return;var sessions=await loadSessions(),others=sessions.filter(function(s){return s.job_id===sessJid&&s.user_id!==CU.id;});var banner=document.getElementById('sess-live-banner'),othEl=document.getElementById('sess-others');if(!banner||!othEl)return;if(others.length){banner.innerHTML='<div style="background:rgba(0,255,136,.06);border:1px solid rgba(0,255,136,.2);border-radius:8px;padding:9px 12px;font-size:12px;color:var(--cg);margin-bottom:8px"><span class="ldot2"></span><strong>'+others.length+' other tech'+(others.length>1?'s':'')+' on this job:</strong> '+others.map(function(s){return userName(s.user_id);}).join(', ')+'</div>';othEl.innerHTML='<div style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--tm);margin-bottom:10px">Other Techs - Live Progress</div>'+others.map(function(s){var e=fmtDur(Math.floor((Date.now()-new Date(s.start_time).getTime())/1000));return'<div class="session-card"><div class="session-header"><div style="display:flex;align-items:center;gap:9px"><div class="av avlg">'+userInit(s.user_id)+'</div><div><div style="font-size:14px;font-weight:600">'+userName(s.user_id)+'</div></div></div><span class="ldot2"></span><span style="font-size:12px;color:var(--cg)">'+e+'</span></div><div class="sess-grid"><div class="sfield"><div class="sfval">'+s.lt3+'</div><div class="sflbl">&lt;3 Px</div></div><div class="sfield"><div class="sfval" style="color:var(--cr)">'+s.gt3+'</div><div class="sflbl">&gt;3 Px</div></div><div class="sfield"><div class="sfval" style="color:var(--c2)">'+s.track+'</div><div class="sflbl">Track</div></div><div class="sfield"><div class="sfval" style="color:var(--cp)">'+s.chip+'</div><div class="sflbl">Chip</div></div><div class="sfield"><div class="sfval" style="color:var(--cr)">'+s.ber+'</div><div class="sflbl">BER</div></div><div class="sfield"><div class="sfval" style="color:var(--cg)">'+s.qty+'</div><div class="sflbl">Qty</div></div><div class="sfield"><div class="sfval" style="color:var(--c1)">'+(s.mod_tested||0)+'</div><div class="sflbl">Tested</div></div><div class="sfield"><div class="sfval" style="color:var(--cg)">'+(s.mod_passed||0)+'</div><div class="sflbl">Passed</div></div></div></div>';}).join('');}else{banner.innerHTML='';othEl.innerHTML='';}}
async function submitSession(){if(!sessJid)return;var j=allJobs.find(function(x){return x.id===sessJid;});if(!j)return;var now=new Date().toISOString(),lt=parseInt(document.getElementById('wl-lt3').value)||0,gt=parseInt(document.getElementById('wl-gt3').value)||0,tr=parseInt(document.getElementById('wl-track').value)||0,ch=parseInt(document.getElementById('wl-chip').value)||0;var{error:e1}=await sb.from('rc_work_logs').insert({job_id:sessJid,user_id:CU.id,start_time:sessStart.toISOString(),end_time:now,batch:j.batch,pitch:j.pitch,lt3:lt,gt3:gt,track:tr,chip:ch,ber:parseInt(document.getElementById('wl-ber').value)||0,qty:lt+gt+tr+ch,mod_tested:parseInt(document.getElementById('wl-mod-tested').value)||0,mod_passed:parseInt(document.getElementById('wl-mod-passed').value)||0,notes:document.getElementById('wl-notes').value});if(e1){toast('Error saving log: '+e1.message,'error');return;}await sb.from('rc_work_sessions').delete().eq('job_id',sessJid).eq('user_id',CU.id);if(sessInterval)clearInterval(sessInterval);sessJid=null;sessStart=null;await loadLogs();cm('m-session');toast('Work session submitted!','success');refreshAllTables();renderWLPage();updateActiveNB();}
async function abandonSession(){if(!sessJid)return;await sb.from('rc_work_sessions').delete().eq('job_id',sessJid).eq('user_id',CU.id);if(sessInterval)clearInterval(sessInterval);sessJid=null;sessStart=null;cm('m-session');toast('Session abandoned','info');refreshAllTables();updateActiveNB();}
async function updateActiveNB(){var sessions=await loadSessions();var count=sessions.length;var nb=document.getElementById('nb-active');if(nb){nb.textContent=count;nb.style.display=count?'':'none';}}
async function refreshActivePage(){if(!document.getElementById('page-active').classList.contains('active'))return;var sessions=await loadSessions();var ind=document.getElementById('active-ind');if(ind)ind.textContent=sessions.length?sessions.length+' active session'+(sessions.length>1?'s':'')+' live':'No active sessions';if(!sessions.length){document.getElementById('active-cont').innerHTML='<div class="empty"><div class="eico"> </div><p class="etxt">No active work sessions right now</p></div>';return;}var jobIds=[...new Set(sessions.map(function(s){return s.job_id;}))];document.getElementById('active-cont').innerHTML=jobIds.map(function(jid){var j=allJobs.find(function(x){return x.id===jid;});var jSess=sessions.filter(function(s){return s.job_id===jid;});if(!j)return'';return'<div style="background:var(--bgc);border:1px solid var(--bdr);border-radius:12px;padding:18px;margin-bottom:16px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px"><div><span style="font-family:Rajdhani,sans-serif;font-size:18px;font-weight:700;color:var(--c1)">'+j.job_number+'</span> <span style="font-size:15px;font-weight:500">'+j.job_name+'</span></div><span class="bdg '+sc(j.status)+'"><span class="bdot"></span>'+j.status+'</span></div>'+jSess.map(function(s){var elapsed=fmtDur(Math.floor((Date.now()-new Date(s.start_time).getTime())/1000));return'<div class="session-card"><div class="session-header"><div style="display:flex;align-items:center;gap:9px"><div class="av avlg">'+userInit(s.user_id)+'</div><div><div style="font-size:14px;font-weight:600">'+userName(s.user_id)+'</div><div style="font-size:12px;color:var(--tm)">'+s.start_time.slice(0,16).replace('T',' ')+'</div></div></div><span><span class="ldot2"></span><span style="font-size:12px;color:var(--cg)">'+elapsed+'</span></span></div><div class="sess-grid"><div class="sfield"><div class="sfval">'+s.lt3+'</div><div class="sflbl">&lt;3 Px</div></div><div class="sfield"><div class="sfval" style="color:var(--cr)">'+s.gt3+'</div><div class="sflbl">&gt;3 Px</div></div><div class="sfield"><div class="sfval" style="color:var(--c2)">'+s.track+'</div><div class="sflbl">Track</div></div><div class="sfield"><div class="sfval" style="color:var(--cp)">'+s.chip+'</div><div class="sflbl">Chip</div></div><div class="sfield"><div class="sfval" style="color:var(--cr)">'+s.ber+'</div><div class="sflbl">BER</div></div><div class="sfield"><div class="sfval" style="color:var(--cg)">'+s.qty+'</div><div class="sflbl">Qty</div></div><div class="sfield"><div class="sfval" style="color:var(--c1)">'+(s.mod_tested||0)+'</div><div class="sflbl">Tested</div></div><div class="sfield"><div class="sfval" style="color:var(--cg)">'+(s.mod_passed||0)+'</div><div class="sflbl">Passed</div></div></div>'+(s.notes?'<div style="font-size:12px;color:var(--tm)">'+s.notes+'</div>':'')+' </div>';}).join('')+'</div>';}).join('');}

// ==============================================
//  WORK LOG PAGE
// ==============================================
function renderWLPage(){if(!allLogs.length){document.getElementById('wlcont').innerHTML='<div class="empty"><div class="eico"> </div><p class="etxt">No work logs yet</p></div>';return;}document.getElementById('wlcont').innerHTML='<div class="tc"><div class="twrap"><table class="dt"><thead><tr><th>Technician</th><th>Job</th><th>Start</th><th>End</th><th>Duration</th><th>&lt;3 Px</th><th>&gt;3 Px</th><th>Track</th><th>Chip</th><th>BER</th><th>Qty Total</th><th>Mod Tested</th><th>Mod Passed</th><th>Notes</th></tr></thead><tbody>'+allLogs.map(function(wl){var dur='-';if(wl.start_time&&wl.end_time)dur=fmtDur(Math.floor((new Date(wl.end_time)-new Date(wl.start_time))/1000));var j=allJobs.find(function(x){return x.id===wl.job_id;});return'<tr><td><div class="chip">'+userName(wl.user_id)+'</div></td><td><span style="color:var(--c1);font-weight:600">'+(j?j.job_number:wl.job_id.slice(0,8))+'</span><br><span style="font-size:11px;color:var(--tm)">'+(j?j.job_name:'')+'</span></td><td style="font-size:12px;color:var(--tm)">'+(wl.start_time?wl.start_time.slice(0,16).replace('T',' '):'-')+'</td><td style="font-size:12px;color:var(--tm)">'+(wl.end_time?wl.end_time.slice(0,16).replace('T',' '):'-')+'</td><td style="font-family:Rajdhani,sans-serif;color:var(--c1)">'+dur+'</td><td style="color:var(--cy);font-weight:600">'+wl.lt3+'</td><td style="color:var(--cr);font-weight:600">'+wl.gt3+'</td><td style="color:var(--c2)">'+wl.track+'</td><td style="color:var(--cp)">'+wl.chip+'</td><td style="color:var(--cr)">'+wl.ber+'</td><td style="color:var(--cg);font-family:Rajdhani,sans-serif;font-size:16px;font-weight:700">'+wl.qty+'</td><td style="color:var(--c1);font-weight:600">'+(wl.mod_tested||0)+'</td><td style="color:var(--cg);font-weight:600">'+(wl.mod_passed||0)+'</td><td style="font-size:12px;color:var(--tm);max-width:160px">'+(wl.notes||'-')+'</td></tr>';}).join('')+'</tbody></table></div></div>';}

// ==============================================
//  JOB CRUD
// ==============================================
function fillAssigned(selId,selVal){var el=document.getElementById(selId);if(!el)return;var ca=CU.is_admin||CU.is_senior;el.innerHTML='<option value="">Unassigned</option>'+allUsers.filter(function(u){return!u.is_admin&&u.status==='active';}).map(function(u){return'<option value="'+u.id+'"'+(u.id===selVal?' selected':'')+'>'+u.name+' ('+u.role+')</option>';}).join('');el.disabled=!ca;el.style.opacity=ca?'1':'0.5';}
function openCreateJob(){editJid=null;document.getElementById('m-job-ttl').textContent='Create New Job';document.getElementById('jdate').value=new Date().toISOString().slice(0,16);['jclient','jjname','jbatch','jqty','jnotes','jspares'].forEach(function(id){document.getElementById(id).value='';});document.getElementById('jpitch').value='';document.getElementById('jprio').value='Medium';document.getElementById('jstatus').value='Pending';document.getElementById('jflist').textContent='';fillAssigned('jassigned','');om('m-job');}
async function openEdit(id){var j=allJobs.find(function(x){return x.id===id;});if(!j)return;editJid=id;document.getElementById('m-job-ttl').textContent='Edit Job - '+j.job_number;document.getElementById('jdate').value=j.job_date?j.job_date.slice(0,16):'';document.getElementById('jclient').value=j.client;document.getElementById('jjname').value=j.job_name;document.getElementById('jbatch').value=j.batch||'';document.getElementById('jqty').value=j.qty;document.getElementById('jpitch').value=j.pitch||'';document.getElementById('jprio').value=j.priority;document.getElementById('jstatus').value=j.status;document.getElementById('jnotes').value=j.notes||'';document.getElementById('jspares').value=j.spares||'';document.getElementById('jflist').textContent=(j.files||[]).join(', ');fillAssigned('jassigned',j.assigned_to||'');om('m-job');}
async function saveJob(){var name=document.getElementById('jjname').value.trim(),client=document.getElementById('jclient').value.trim();if(!name||!client){toast('Fill in Job Name and Client.','error');return;}var btn=document.getElementById('save-job-btn');btn.disabled=true;btn.innerHTML='<span class="spin"></span>Saving...';var fi=document.getElementById('jfiles'),ef=editJid?((allJobs.find(function(j){return j.id===editJid;})||{files:[]}).files||[]).slice():[],nf=[];for(var i=0;i<fi.files.length;i++)nf.push(fi.files[i].name);var af=ef.concat(nf);var ca=CU.is_admin||CU.is_senior;var d={job_name:name,client:client,batch:document.getElementById('jbatch').value.trim()||'BATCH-'+Date.now(),qty:parseInt(document.getElementById('jqty').value)||1,pitch:document.getElementById('jpitch').value,priority:document.getElementById('jprio').value,status:document.getElementById('jstatus').value,assigned_to:ca?(document.getElementById('jassigned').value||null):undefined,job_date:document.getElementById('jdate').value||null,notes:document.getElementById('jnotes').value,spares:document.getElementById('jspares').value,files:af};var err;if(editJid){var r=await sb.from('rc_jobs').update(d).eq('id',editJid);err=r.error;}else{var cnt=allJobs.length+1;d.job_number='J'+String(cnt).padStart(3,'0');d.created_by=CU.id;var r2=await sb.from('rc_jobs').insert(d);err=r2.error;}btn.disabled=false;btn.textContent='Save Job';if(err){toast('Error: '+err.message,'error');return;}await loadJobs();cm('m-job');renderDash();renderAllJobs();toast(editJid?'Job updated':'Job created','success');}
async function delJob(id){if(!CU.is_admin)return;var{error}=await sb.from('rc_jobs').delete().eq('id',id);if(error){toast('Error: '+error.message,'error');return;}await loadJobs();renderDash();renderAllJobs();toast('Job deleted','error');}
function openStatus(id){var j=allJobs.find(function(x){return x.id===id;});if(!j)return;stJid=id;document.getElementById('stinfo').innerHTML='<strong>'+j.job_number+'</strong> - '+j.job_name+'<br><span style="font-size:12px;color:var(--tm)">'+j.client+'</span>';document.getElementById('stnew').value=j.status;om('m-status');}
async function applyStatus(){var j=allJobs.find(function(x){return x.id===stJid;});if(!j)return;var ns=document.getElementById('stnew').value;await sb.from('rc_jobs').update({status:ns}).eq('id',stJid);await loadJobs();toast('Status: '+ns,'success');cm('m-status');renderDash();renderAllJobs();}

// ==============================================
//  REPORTS
// ==============================================
function prepReports(){var today=new Date(),fd=document.getElementById('rep-from'),td=document.getElementById('rep-to');if(fd&&!fd.value)fd.value=new Date(today.getFullYear(),today.getMonth(),1).toISOString().slice(0,10);if(td&&!td.value)td.value=today.toISOString().slice(0,10);}
function getFilteredLogs(){var from=document.getElementById('rep-from').value,to=document.getElementById('rep-to').value,uid=document.getElementById('rep-user').value,logs=allLogs;if(from)logs=logs.filter(function(wl){return wl.start_time>=from;});if(to)logs=logs.filter(function(wl){return wl.start_time<=(to+'T23:59');});if(uid)logs=logs.filter(function(wl){return wl.user_id===uid;});return logs;}
function generateReport(){
  var logs=getFilteredLogs();
  var from=document.getElementById('rep-from').value||'-';
  var to=document.getElementById('rep-to').value||'-';
  if(!logs.length){
    document.getElementById('rep-preview').innerHTML='<div class="empty"><div class="eico"> </div><p class="etxt">No logs found for this period</p></div>';
    return;
  }

  // Grand totals
  var totSess=logs.length,totSecs=0,totLt3=0,totGt3=0,totTrack=0,totChip=0,totBer=0,totQty=0,totModTested=0,totModPassed=0;
  logs.forEach(function(wl){
    totLt3+=wl.lt3;totGt3+=wl.gt3;totTrack+=wl.track;totChip+=wl.chip;totBer+=wl.ber;totQty+=wl.qty;totModTested+=(wl.mod_tested||0);totModPassed+=(wl.mod_passed||0);
    if(wl.start_time&&wl.end_time)totSecs+=Math.floor((new Date(wl.end_time)-new Date(wl.start_time))/1000);
  });

  // Group: user -> job -> sessions
  var byUser={};
  logs.forEach(function(wl){
    if(!byUser[wl.user_id])byUser[wl.user_id]={};
    var jid=wl.job_id||'__unknown__';
    if(!byUser[wl.user_id][jid])byUser[wl.user_id][jid]=[];
    byUser[wl.user_id][jid].push(wl);
  });

  var h='<div style="background:var(--bgc);border:1px solid var(--bdr);border-radius:12px;padding:20px">';
  h+='<div style="margin-bottom:16px">';
  h+='<div style="font-family:Rajdhani,sans-serif;font-size:20px;font-weight:700;color:var(--c1)">Work Log Summary Report</div>';
  h+='<div style="font-size:12px;color:var(--tm)">'+from+' to '+to+'  &middot;  '+totSess+' sessions  &middot;  '+fmtDur(totSecs)+' total  &middot;  '+Object.keys(byUser).length+' technicians</div>';
  h+='</div>';

  // Grand total stat cards
  h+='<div class="sg" style="margin-bottom:22px">';
  h+='<div class="sc blue"><div class="slb">Sessions</div><div class="sv">'+totSess+'</div></div>';
  h+='<div class="sc orange"><div class="slb">Total Time</div><div class="sv" style="font-size:18px">'+fmtDur(totSecs)+'</div></div>';
  h+='<div class="sc green"><div class="slb">Modules</div><div class="sv">'+totQty+'</div></div>';
  h+='<div class="sc red"><div class="slb">Technicians</div><div class="sv">'+Object.keys(byUser).length+'</div></div>';
  h+='</div>';

  // Per-technician section
  Object.keys(byUser).forEach(function(uid){
    var u=allUsers.find(function(x){return x.id===uid;});
    var uJobs=byUser[uid];
    var uSecs=0,uLt3=0,uGt3=0,uTrack=0,uChip=0,uBer=0,uQty=0,uSess=0,uModTested=0,uModPassed=0;
    Object.keys(uJobs).forEach(function(jid){
      uJobs[jid].forEach(function(wl){
        uLt3+=wl.lt3;uGt3+=wl.gt3;uTrack+=wl.track;uChip+=wl.chip;uBer+=wl.ber;uQty+=wl.qty;uModTested+=(wl.mod_tested||0);uModPassed+=(wl.mod_passed||0);uSess++;
        if(wl.start_time&&wl.end_time)uSecs+=Math.floor((new Date(wl.end_time)-new Date(wl.start_time))/1000);
      });
    });

    // Tech header
    h+='<div style="background:var(--bgc2);border:1px solid var(--bdr);border-radius:10px;overflow:hidden;margin-bottom:16px">';
    h+='<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--bdr);background:rgba(0,0,0,.2)">';
    var init=(u?(u.initials||(u.name.split(' ').map(function(w){return w[0];}).join('').slice(0,2).toUpperCase())):'?');
    h+='<div style="width:38px;height:38px;border-radius:50%;background:rgba(0,212,255,.12);display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-size:14px;font-weight:700;color:var(--c1);border:1px solid rgba(0,212,255,.3);flex-shrink:0">'+init+'</div>';
    h+='<div style="flex:1"><div style="font-family:Rajdhani,sans-serif;font-size:17px;font-weight:700">'+(u?u.name:'Unknown')+'</div>';
    h+='<div style="font-size:11px;color:var(--tm)">'+(u?u.role:'')+' &nbsp;&middot;&nbsp; '+uSess+' session'+(uSess!==1?'s':'')+' &nbsp;&middot;&nbsp; '+fmtDur(uSecs)+' total time</div></div>';
    // Tech totals inline
    h+='<div style="display:flex;gap:14px;flex-wrap:wrap">';
    h+='<div style="text-align:right"><div style="font-family:Rajdhani,sans-serif;font-size:18px;font-weight:700;color:var(--cg)">'+uQty+'</div><div style="font-size:10px;color:var(--tm);text-transform:uppercase;letter-spacing:.5px">Modules</div></div>';
    h+='<div style="text-align:right"><div style="font-family:Rajdhani,sans-serif;font-size:18px;font-weight:700;color:var(--cy)">'+uLt3+'</div><div style="font-size:10px;color:var(--tm);text-transform:uppercase;letter-spacing:.5px">&lt;3 Px</div></div>';
    h+='<div style="text-align:right"><div style="font-family:Rajdhani,sans-serif;font-size:18px;font-weight:700;color:var(--cr)">'+uGt3+'</div><div style="font-size:10px;color:var(--tm);text-transform:uppercase;letter-spacing:.5px">&gt;3 Px</div></div>';
    h+='</div></div>';

    // Job summary table for this tech
    h+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
    h+='<thead><tr>';
    ['Job #','Job Name','Client','Pitch','Sessions','Time Spent','<3 Px','>3 Px','Track','Chip','BER','Modules','Mod Tested','Mod Passed'].forEach(function(t){
      h+='<th style="padding:7px 12px;text-align:left;font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--tm);border-bottom:1px solid var(--bdr);white-space:nowrap;background:rgba(0,0,0,.15)">'+t+'</th>';
    });
    h+='</tr></thead><tbody>';

    var jobKeys=Object.keys(uJobs);
    var jTotSecs=0,jTotSess=0,jTotLt3=0,jTotGt3=0,jTotTrack=0,jTotChip=0,jTotBer=0,jTotQty=0,jTotModTested=0,jTotModPassed=0;

    jobKeys.forEach(function(jid,idx){
      var jlogs=uJobs[jid];
      var job=allJobs.find(function(x){return x.id===jid;});
      var jSecs=0,jLt3=0,jGt3=0,jTrack=0,jChip=0,jBer=0,jQty=0,jModTested=0,jModPassed=0;
      jlogs.forEach(function(wl){
        jLt3+=wl.lt3;jGt3+=wl.gt3;jTrack+=wl.track;jChip+=wl.chip;jBer+=wl.ber;jQty+=wl.qty;jModTested+=(wl.mod_tested||0);jModPassed+=(wl.mod_passed||0);
        if(wl.start_time&&wl.end_time)jSecs+=Math.floor((new Date(wl.end_time)-new Date(wl.start_time))/1000);
      });
      jTotSecs+=jSecs;jTotSess+=jlogs.length;jTotLt3+=jLt3;jTotGt3+=jGt3;
      jTotTrack+=jTrack;jTotChip+=jChip;jTotBer+=jBer;jTotQty+=jQty;jTotModTested+=jModTested;jTotModPassed+=jModPassed;

      var rowBg=idx%2===0?'':'background:rgba(255,255,255,.02)';
      h+='<tr style="'+rowBg+'">';
      h+='<td style="padding:8px 12px;font-family:Rajdhani,sans-serif;font-weight:700;color:var(--c1)">'+(job?job.job_number:'?')+'</td>';
      h+='<td style="padding:8px 12px;font-weight:500">'+(job?job.job_name:'Unknown')+'</td>';
      h+='<td style="padding:8px 12px;color:var(--tm)">'+(job?job.client:'-')+'</td>';
      h+='<td style="padding:8px 12px"><span style="background:rgba(168,85,247,.1);color:var(--cp);padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600">'+(job&&job.pitch?job.pitch:'-')+'</span></td>';
      h+='<td style="padding:8px 12px;text-align:center;color:var(--tm)">'+jlogs.length+'</td>';
      h+='<td style="padding:8px 12px;font-family:Rajdhani,sans-serif;color:var(--c1);font-weight:600;white-space:nowrap">'+fmtDur(jSecs)+'</td>';
      h+='<td style="padding:8px 12px;text-align:center;color:var(--cy);font-weight:600">'+jLt3+'</td>';
      h+='<td style="padding:8px 12px;text-align:center;color:var(--cr);font-weight:600">'+jGt3+'</td>';
      h+='<td style="padding:8px 12px;text-align:center;color:var(--c2)">'+jTrack+'</td>';
      h+='<td style="padding:8px 12px;text-align:center;color:var(--cp)">'+jChip+'</td>';
      h+='<td style="padding:8px 12px;text-align:center;color:var(--cr)">'+jBer+'</td>';
      h+='<td style="padding:8px 12px;text-align:center;font-family:Rajdhani,sans-serif;font-size:15px;font-weight:700;color:var(--cg)">'+jQty+'</td>';
      h+='<td style="padding:8px 12px;text-align:center;color:var(--c1);font-weight:600">'+jModTested+'</td>';
      h+='<td style="padding:8px 12px;text-align:center;color:var(--cg);font-weight:600">'+jModPassed+'</td>';
      h+='</tr>';
    });

    // Technician totals row
    h+='<tr style="background:rgba(0,212,255,.07);border-top:1px solid var(--bdr)">';
    h+='<td colspan="4" style="padding:8px 12px;font-family:Rajdhani,sans-serif;font-weight:700;color:var(--c1)">TOTAL</td>';
    h+='<td style="padding:8px 12px;text-align:center;font-weight:700">'+jTotSess+'</td>';
    h+='<td style="padding:8px 12px;font-family:Rajdhani,sans-serif;font-weight:700;color:var(--c1)">'+fmtDur(jTotSecs)+'</td>';
    h+='<td style="padding:8px 12px;text-align:center;font-weight:700;color:var(--cy)">'+jTotLt3+'</td>';
    h+='<td style="padding:8px 12px;text-align:center;font-weight:700;color:var(--cr)">'+jTotGt3+'</td>';
    h+='<td style="padding:8px 12px;text-align:center;font-weight:700;color:var(--c2)">'+jTotTrack+'</td>';
    h+='<td style="padding:8px 12px;text-align:center;font-weight:700;color:var(--cp)">'+jTotChip+'</td>';
    h+='<td style="padding:8px 12px;text-align:center;font-weight:700;color:var(--cr)">'+jTotBer+'</td>';
    h+='<td style="padding:8px 12px;text-align:center;font-family:Rajdhani,sans-serif;font-size:16px;font-weight:700;color:var(--cg)">'+jTotQty+'</td>';
    h+='<td style="padding:8px 12px;text-align:center;font-weight:700;color:var(--c1)">'+jTotModTested+'</td>';
    h+='<td style="padding:8px 12px;text-align:center;font-weight:700;color:var(--cg)">'+jTotModPassed+'</td>';
    h+='</tr>';
    h+='</tbody></table></div></div>';
  });
  h+='</div>';
  document.getElementById('rep-preview').innerHTML=h;
}
function downloadPDF(){
  var logs=getFilteredLogs();
  var from=document.getElementById('rep-from').value||'all';
  var to=document.getElementById('rep-to').value||'all';
  if(!logs.length){toast('No logs for this period','error');return;}
  if(typeof window.jspdf==='undefined'){toast('PDF library loading, try again','info');return;}

  var doc=new window.jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  var W=297,H=210,M=12;

  // Colours
  var BG_PAGE =[10,13,20];
  var BG_HDR  =[17,24,39];
  var BG_BAND =[26,34,52];
  var CYAN    =[0,212,255];
  var GREEN   =[0,255,136];
  var AMBER   =[255,204,0];
  var RED     =[255,51,85];
  var ORANGE  =[255,107,0];
  var PURPLE  =[168,85,247];
  var TXT_PRI =[232,234,240];
  var TXT_MUT =[120,133,153];
  var BORDER  =[30,42,65];

  function newPage(){
    doc.addPage();
    doc.setFillColor.apply(doc,BG_PAGE);
    doc.rect(0,0,W,H,'F');
  }

  // Grand totals
  var totSess=logs.length,totSecs=0,totLt3=0,totGt3=0,totTrack=0,totChip=0,totBer=0,totQty=0,totModTested=0,totModPassed=0;
  logs.forEach(function(wl){
    totLt3+=wl.lt3;totGt3+=wl.gt3;totTrack+=wl.track;totChip+=wl.chip;totBer+=wl.ber;totQty+=wl.qty;totModTested+=(wl.mod_tested||0);totModPassed+=(wl.mod_passed||0);
    if(wl.start_time&&wl.end_time)totSecs+=Math.floor((new Date(wl.end_time)-new Date(wl.start_time))/1000);
  });

  // Group: user -> job -> sessions
  var byUser={};
  logs.forEach(function(wl){
    if(!byUser[wl.user_id])byUser[wl.user_id]={};
    var jid=wl.job_id||'__unknown__';
    if(!byUser[wl.user_id][jid])byUser[wl.user_id][jid]=[];
    byUser[wl.user_id][jid].push(wl);
  });

  // ---- PAGE 1: MASTER SUMMARY ----
  doc.setFillColor.apply(doc,BG_PAGE);
  doc.rect(0,0,W,H,'F');

  // Header
  doc.setFillColor.apply(doc,BG_HDR);
  doc.rect(0,0,W,26,'F');
  doc.setFillColor.apply(doc,CYAN);
  doc.rect(0,0,3,26,'F');
  doc.setFillColor.apply(doc,CYAN);
  doc.circle(M+5,13,4,'F');
  doc.setFillColor.apply(doc,BG_PAGE);
  doc.circle(M+5,13,2,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(14);doc.setTextColor.apply(doc,TXT_PRI);
  doc.text('EYECOM LED SOLUTIONS - REPAIR CENTRE',M+13,11);
  doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor.apply(doc,CYAN);
  doc.text('WORK LOG SUMMARY REPORT - BY TECHNICIAN',M+13,18);
  doc.setFontSize(7.5);doc.setTextColor.apply(doc,TXT_MUT);
  doc.text('Period: '+from+' to '+to+'   |   '+totSess+' sessions   |   '+Object.keys(byUser).length+' technicians',M+13,23.5);
  doc.text('Generated: '+new Date().toLocaleString(),W-M,23.5,{align:'right'});

  var y=34;

  // Grand stat cards
  var gcards=[
    {l:'Sessions',v:totSess,c:CYAN},
    {l:'Total Time',v:fmtDur(totSecs),c:AMBER,small:true},
    {l:'Technicians',v:Object.keys(byUser).length,c:PURPLE},
    {l:'<3 Pixels',v:totLt3,c:AMBER},
    {l:'>3 Pixels',v:totGt3,c:RED},
    {l:'Track Damage',v:totTrack,c:ORANGE},
    {l:'Chip Faults',v:totChip,c:PURPLE},
    {l:'B.E.R',v:totBer,c:RED},
    {l:'Total Modules',v:totQty,c:GREEN},
    {l:'Mod Tested',v:totModTested,c:CYAN},
    {l:'Mod Passed',v:totModPassed,c:GREEN}
  ];
  var cw=(W-M*2-8)/gcards.length,ch=18;
  gcards.forEach(function(s,i){
    var cx=M+i*(cw+1);
    doc.setFillColor.apply(doc,BG_BAND);
    doc.roundedRect(cx,y,cw,ch,1.5,1.5,'F');
    doc.setFillColor.apply(doc,s.c);
    doc.roundedRect(cx,y,cw,2,1,0,'F');
    doc.rect(cx,y+1,cw,1,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(s.small?7.5:10);doc.setTextColor.apply(doc,s.c);
    doc.text(String(s.v),cx+cw/2,y+10,{align:'center'});
    doc.setFont('helvetica','normal');doc.setFontSize(4.8);doc.setTextColor.apply(doc,TXT_MUT);
    doc.text(s.l.toUpperCase(),cx+cw/2,y+15.5,{align:'center'});
  });
  y+=ch+10;

  // Master summary: one row per technician
  doc.setFillColor.apply(doc,BG_BAND);
  doc.rect(M,y,W-M*2,9,'F');
  doc.setFillColor.apply(doc,CYAN);
  doc.rect(M,y,2.5,9,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor.apply(doc,TXT_PRI);
  doc.text('TECHNICIAN OVERVIEW',M+6,y+5.8);
  y+=12;

  var masterRows=Object.keys(byUser).map(function(uid){
    var u=allUsers.find(function(x){return x.id===uid;});
    var uJobs=byUser[uid];
    var uSecs=0,uLt3=0,uGt3=0,uTrack=0,uChip=0,uBer=0,uQty=0,uSess=0,uModTested=0,uModPassed=0;
    Object.keys(uJobs).forEach(function(jid){
      uJobs[jid].forEach(function(wl){
        uLt3+=wl.lt3;uGt3+=wl.gt3;uTrack+=wl.track;uChip+=wl.chip;uBer+=wl.ber;uQty+=wl.qty;uModTested+=(wl.mod_tested||0);uModPassed+=(wl.mod_passed||0);uSess++;
        if(wl.start_time&&wl.end_time)uSecs+=Math.floor((new Date(wl.end_time)-new Date(wl.start_time))/1000);
      });
    });
    return [
      u?u.name:'Unknown',
      u?u.role:'-',
      String(Object.keys(uJobs).length),
      String(uSess),
      fmtDur(uSecs),
      String(uLt3),String(uGt3),String(uTrack),String(uChip),String(uBer),String(uQty),String(uModTested),String(uModPassed)
    ];
  });
  masterRows.push(['TOTALS','','-',String(totSess),fmtDur(totSecs),String(totLt3),String(totGt3),String(totTrack),String(totChip),String(totBer),String(totQty),String(totModTested),String(totModPassed)]);

  doc.autoTable({
    startY:y,
    head:[['Technician','Role','Jobs','Sessions','Total Time','<3 Px','>3 Px','Track','Chip','BER','Modules','Mod Tested','Mod Passed']],
    body:masterRows,
    theme:'grid',
    headStyles:{fillColor:BG_BAND,textColor:CYAN,fontSize:7,fontStyle:'bold',lineColor:BORDER,lineWidth:0.3},
    bodyStyles:{fillColor:BG_PAGE,textColor:TXT_PRI,fontSize:8,lineColor:BORDER,lineWidth:0.2},
    alternateRowStyles:{fillColor:BG_BAND},
    columnStyles:{
      0:{fontStyle:'bold'},
      4:{textColor:AMBER,halign:'center'},
      5:{textColor:AMBER,halign:'center'},
      6:{textColor:RED,halign:'center'},
      7:{textColor:ORANGE,halign:'center'},
      8:{textColor:PURPLE,halign:'center'},
      9:{textColor:RED,halign:'center'},
      10:{textColor:GREEN,fontStyle:'bold',halign:'center',fontSize:9},
      11:{textColor:CYAN,halign:'center'},
      12:{textColor:GREEN,halign:'center'}
    },
    didParseCell:function(data){
      if(data.row.index===masterRows.length-1){
        data.cell.styles.fillColor=BG_HDR;
        data.cell.styles.textColor=GREEN;
        data.cell.styles.fontStyle='bold';
      }
    },
    margin:{left:M,right:M},
    tableLineColor:BORDER,tableLineWidth:0.3
  });

  // ---- PER-TECHNICIAN PAGES ----
  Object.keys(byUser).forEach(function(uid){
    var u=allUsers.find(function(x){return x.id===uid;});
    var uJobs=byUser[uid];

    // Compute tech totals
    var uSecs=0,uLt3=0,uGt3=0,uTrack=0,uChip=0,uBer=0,uQty=0,uSess=0,uModTested=0,uModPassed=0;
    Object.keys(uJobs).forEach(function(jid){
      uJobs[jid].forEach(function(wl){
        uLt3+=wl.lt3;uGt3+=wl.gt3;uTrack+=wl.track;uChip+=wl.chip;uBer+=wl.ber;uQty+=wl.qty;uModTested+=(wl.mod_tested||0);uModPassed+=(wl.mod_passed||0);uSess++;
        if(wl.start_time&&wl.end_time)uSecs+=Math.floor((new Date(wl.end_time)-new Date(wl.start_time))/1000);
      });
    });

    newPage();
    var py=16;

    // Technician header band
    doc.setFillColor.apply(doc,BG_HDR);
    doc.rect(M,py,W-M*2,12,'F');
    doc.setFillColor.apply(doc,CYAN);
    doc.rect(M,py,2.5,12,'F');

    // Avatar circle
    doc.setFillColor.apply(doc,[0,212,255,30]);
    doc.circle(M+11,py+6,5,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(6);doc.setTextColor.apply(doc,CYAN);
    var init=u?(u.initials||(u.name.split(' ').map(function(w){return w[0];}).join('').slice(0,2).toUpperCase())):'?';
    doc.text(init,M+11,py+7.5,{align:'center'});

    // Name + role
    doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor.apply(doc,TXT_PRI);
    doc.text(u?u.name:'Unknown Technician',M+20,py+6.5);
    doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor.apply(doc,TXT_MUT);
    doc.text((u?u.role:'')+' | '+uSess+' sessions | '+fmtDur(uSecs)+' | '+Object.keys(uJobs).length+' jobs | '+uQty+' modules repaired',M+20,py+10.5);
    py+=15;

    // Stat pills for this tech
    var pills=[
      {l:'<3 Pixels',v:uLt3,c:AMBER},{l:'>3 Pixels',v:uGt3,c:RED},
      {l:'Track',v:uTrack,c:ORANGE},{l:'Chip',v:uChip,c:PURPLE},
      {l:'BER',v:uBer,c:RED},{l:'Total Time',v:fmtDur(uSecs),c:CYAN,small:true},{l:'Modules',v:uQty,c:GREEN},
      {l:'Mod Tested',v:uModTested,c:CYAN},{l:'Mod Passed',v:uModPassed,c:GREEN}
    ];
    var pw=(W-M*2-6)/pills.length,ph=13;
    pills.forEach(function(s,i){
      var px=M+i*(pw+1);
      doc.setFillColor.apply(doc,BG_BAND);
      doc.roundedRect(px,py,pw,ph,1,1,'F');
      doc.setFont('helvetica','bold');doc.setFontSize(s.small?7:9.5);doc.setTextColor.apply(doc,s.c);
      doc.text(String(s.v),px+pw/2,py+7.5,{align:'center'});
      doc.setFont('helvetica','normal');doc.setFontSize(4.8);doc.setTextColor.apply(doc,TXT_MUT);
      doc.text(s.l.toUpperCase(),px+pw/2,py+11.5,{align:'center'});
    });
    py+=ph+6;

    // Section label
    doc.setFillColor.apply(doc,BG_BAND);
    doc.rect(M,py,W-M*2,8,'F');
    doc.setFillColor.apply(doc,CYAN);
    doc.rect(M,py,2.5,8,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(7);doc.setTextColor.apply(doc,TXT_MUT);
    doc.text('JOB BREAKDOWN - one row per job, all sessions combined',M+6,py+5);
    py+=11;

    // Job breakdown table for this tech
    var jobRows=Object.keys(uJobs).map(function(jid){
      var jlogs=uJobs[jid];
      var job=allJobs.find(function(x){return x.id===jid;});
      var jSecs=0,jLt3=0,jGt3=0,jTrack=0,jChip=0,jBer=0,jQty=0,jModTested=0,jModPassed=0;
      jlogs.forEach(function(wl){
        jLt3+=wl.lt3;jGt3+=wl.gt3;jTrack+=wl.track;jChip+=wl.chip;jBer+=wl.ber;jQty+=wl.qty;jModTested+=(wl.mod_tested||0);jModPassed+=(wl.mod_passed||0);
        if(wl.start_time&&wl.end_time)jSecs+=Math.floor((new Date(wl.end_time)-new Date(wl.start_time))/1000);
      });
      return [
        job?job.job_number:'?',
        job?job.job_name:'Unknown',
        job?job.client:'-',
        job&&job.pitch?job.pitch:'-',
        String(jlogs.length),
        fmtDur(jSecs),
        String(jLt3),String(jGt3),String(jTrack),String(jChip),String(jBer),String(jQty),String(jModTested),String(jModPassed)
      ];
    });
    // Sort by time spent desc
    jobRows.sort(function(a,b){
      var sa=a[5],sb=b[5];
      return sb.localeCompare(sa);
    });
    // Totals row
    jobRows.push(['TOTAL','','','',String(uSess),fmtDur(uSecs),String(uLt3),String(uGt3),String(uTrack),String(uChip),String(uBer),String(uQty),String(uModTested),String(uModPassed)]);

    doc.autoTable({
      startY:py,
      head:[['Job #','Job Name','Client','Pitch','Sessions','Time Spent','<3 Px','>3 Px','Track','Chip','BER','Modules','Mod Tested','Mod Passed']],
      body:jobRows,
      theme:'grid',
      headStyles:{fillColor:BG_BAND,textColor:CYAN,fontSize:6.5,fontStyle:'bold',lineColor:BORDER,lineWidth:0.3,halign:'center'},
      bodyStyles:{fillColor:BG_PAGE,textColor:TXT_PRI,fontSize:7.5,lineColor:BORDER,lineWidth:0.2},
      alternateRowStyles:{fillColor:BG_BAND},
      columnStyles:{
        0:{fontStyle:'bold',textColor:CYAN},
        5:{textColor:AMBER,fontStyle:'bold',halign:'center'},
        6:{textColor:AMBER,halign:'center'},
        7:{textColor:RED,halign:'center'},
        8:{textColor:ORANGE,halign:'center'},
        9:{textColor:PURPLE,halign:'center'},
        10:{textColor:RED,halign:'center'},
        11:{textColor:GREEN,fontStyle:'bold',halign:'center',fontSize:9},
        12:{textColor:CYAN,halign:'center'},
        13:{textColor:GREEN,halign:'center'}
      },
      didParseCell:function(data){
        if(data.row.index===jobRows.length-1){
          data.cell.styles.fillColor=BG_HDR;
          data.cell.styles.textColor=GREEN;
          data.cell.styles.fontStyle='bold';
          data.cell.styles.fontSize=8;
        }
      },
      margin:{left:M,right:M},
      tableLineColor:BORDER,tableLineWidth:0.3
    });
  });

  // Footer on every page
  var pageCount=doc.getNumberOfPages();
  for(var p=1;p<=pageCount;p++){
    doc.setPage(p);
    doc.setFillColor.apply(doc,BG_HDR);
    doc.rect(0,H-8,W,8,'F');
    doc.setFillColor.apply(doc,CYAN);
    doc.rect(0,H-8,W,0.5,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(6);doc.setTextColor.apply(doc,TXT_MUT);
    doc.text('EYECOM LED SOLUTIONS - Work Log Summary | Per-Technician | Confidential',M,H-3);
    doc.text('Page '+p+' of '+pageCount,W-M,H-3,{align:'right'});
  }

  doc.save('eyecom-worklogs-summary-'+from+'-to-'+to+'.pdf');
  toast('Summary PDF downloaded!','success');
}

// ==============================================
//  USERS
// ==============================================
function renderUsers(){if(!allUsers.length){document.getElementById('ugrid').innerHTML='<div class="empty"><div class="eico"> </div><p class="etxt">No users found</p></div>';return;}document.getElementById('ugrid').innerHTML=allUsers.map(function(u){var uj=allJobs.filter(function(j){return j.assigned_to===u.id;}),act=uj.filter(function(j){return j.status==='In Progress';}).length,dn=uj.filter(function(j){return j.status==='Completed';}).length;var ab=u.is_admin?'<span style="background:rgba(0,212,255,.1);color:var(--c1);font-size:9px;padding:2px 6px;border-radius:4px;font-weight:600;margin-left:4px">ADMIN</span>':u.is_senior?'<span style="background:rgba(168,85,247,.1);color:var(--cp);font-size:9px;padding:2px 6px;border-radius:4px;font-weight:600;margin-left:4px">SENIOR</span>':'';var fb=u.status==='frozen'?'<span class="ust s-frozen">Frozen</span>':'<span class="ust s-active">Active</span>';var emailBadge=u.email?(u.email_verified?'<div style="font-size:11px;color:var(--cg);margin-bottom:6px">  '+u.email+'</div>':'<div style="font-size:11px;color:var(--cy);margin-bottom:6px">  '+u.email+' (unverified)</div>'):'<div style="font-size:11px;color:var(--tm);margin-bottom:6px">No email</div>';var acts=u.is_admin?'':(CU.is_admin?'<button class="btn bout bsm" onclick="toggleFreeze(\''+u.id+'\',\''+u.status+'\')">'+( u.status==='frozen'?'Unfreeze':'Freeze')+'</button><button class="btn bdanger bsm" onclick="delUser(\''+u.id+'\')">Delete</button>':'');return'<div class="ucard"><div class="uch"><div class="av avlg">'+(u.initials||u.name.slice(0,2).toUpperCase())+'</div><div class="ucm"><div class="uname">'+u.name+ab+'</div><div class="urole">'+u.role+'</div></div>'+fb+'</div><div class="ucstats"><div class="ucs"><div class="ucsv">'+act+'</div><div class="ucsl">Active Jobs</div></div><div class="ucs"><div class="ucsv">'+dn+'</div><div class="ucsl">Completed</div></div></div>'+emailBadge+'<div style="font-size:12px;color:var(--tm);margin-bottom:12px">@'+u.username+'</div><div class="ucact">'+acts+'</div></div>';}).join('');}
function openCreateUser(){['uname','uun','upw'].forEach(function(id){document.getElementById(id).value='';});document.getElementById('urole').value='Technician';om('m-user');}
async function saveUser(){var name=document.getElementById('uname').value.trim(),un=document.getElementById('uun').value.trim(),pw=document.getElementById('upw').value,role=document.getElementById('urole').value;if(!name||!un||!pw){toast('Fill all fields','error');return;}var btn=document.getElementById('save-user-btn');btn.disabled=true;btn.innerHTML='<span class="spin"></span>Creating...';var init=name.split(' ').map(function(w){return w[0];}).join('').toUpperCase().slice(0,2),isSenior=role==='Senior Technician'||role==='Supervisor';var{error}=await sb.from('rc_users').insert({username:un,password_hash:pw,name:name,role:role,is_admin:false,is_senior:isSenior,status:'active',initials:init});btn.disabled=false;btn.textContent='Create User';if(error){toast('Error: '+(error.message.includes('unique')?'Username already taken':error.message),'error');return;}await loadUsers();toast('User created: '+name,'success');cm('m-user');renderUsers();}
async function toggleFreeze(id,cs){var ns=cs==='frozen'?'active':'frozen';await sb.from('rc_users').update({status:ns}).eq('id',id);await loadUsers();renderUsers();toast(ns==='frozen'?'User frozen':'User unfrozen','info');}
async function delUser(id){var{error}=await sb.from('rc_users').delete().eq('id',id);if(error){toast('Error: '+error.message,'error');return;}await loadUsers();renderUsers();toast('User deleted','error');}

// ==============================================
//  REQUESTS
// ==============================================
function openSendReq(){var ru=document.getElementById('rquser');ru.innerHTML=allUsers.filter(function(u){return u.id!==CU.id&&u.status==='active';}).map(function(u){return'<option value="'+u.id+'">'+u.name+'</option>';}).join('');var rj=document.getElementById('rqjob');rj.innerHTML='<option value="">None</option>'+allJobs.map(function(j){return'<option value="'+j.id+'">'+j.job_number+' - '+j.job_name+'</option>';}).join('');document.getElementById('rqmsg').value='';om('m-req');}
async function sendReq(){var msg=document.getElementById('rqmsg').value.trim();if(!msg){toast('Enter a message','error');return;}var uid=document.getElementById('rquser').value,jid=document.getElementById('rqjob').value||null;var{error}=await sb.from('rc_requests').insert({type:document.getElementById('rqtype').value,from_user:CU.id,to_user:uid,job_id:jid,message:msg});if(error){toast('Error: '+error.message,'error');return;}await loadReqs();toast('Request sent','success');cm('m-req');renderReqs();}
function updateNBReqs(){var n=allReqs.filter(function(r){return r.to_user===CU.id&&!r.is_read;}).length;var nb=document.getElementById('nbr');if(nb){nb.textContent=n;nb.style.display=n?'':'none';}}
function renderReqs(){var mine=CU.is_admin||CU.is_senior?allReqs:allReqs.filter(function(r){return r.to_user===CU.id;});if(!mine.length){document.getElementById('reqcont').innerHTML='<div class="empty"><div class="eico"> </div><p class="etxt">No requests</p></div>';return;}var tmap={update:{icon:' ',bg:'background:rgba(0,212,255,.1)',lbl:'Update Request'},reassign:{icon:' ',bg:'background:rgba(255,107,0,.1)',lbl:'Reassignment'},review:{icon:' ',bg:'background:rgba(168,85,247,.1)',lbl:'Review Request'}};document.getElementById('reqcont').innerHTML='<div class="rpanel"><div class="phead"><div class="pttl">All Requests</div><span style="font-size:12px;color:var(--tm)">'+mine.length+' total</span></div>'+mine.map(function(r){var ti=tmap[r.type]||{icon:' ',bg:'',lbl:'Request'},j2=allJobs.find(function(x){return x.id===r.job_id;});return'<div class="ri"><div class="rico" style="'+ti.bg+'">'+ti.icon+'</div><div style="flex:1"><div style="font-size:13px;font-weight:500;margin-bottom:3px">'+ti.lbl+'</div><div style="font-size:12px;color:var(--tm)">From: <strong>'+userName(r.from_user)+'</strong> -> <strong>'+userName(r.to_user)+'</strong>'+(j2?' | '+j2.job_number:'')+'</div><div style="font-size:13px;margin-top:5px">'+r.message+'</div><div style="font-size:11px;color:var(--tm);margin-top:3px">'+new Date(r.created_at).toLocaleString()+'</div></div></div>';}).join('')+'</div>';}

// ==============================================
//  TOAST
// ==============================================
function toast(msg,type){var icons={success:' ',error:' ',info:' '};var t=document.createElement('div');t.className='toast ts-'+(type||'info');t.innerHTML='<span>'+icons[type||'info']+'</span> '+msg;document.getElementById('toasts').appendChild(t);setTimeout(function(){t.remove();},3400);}

// ===============================
//  KEEP LOGGED IN - localStorage session
// ===============================
var _SK='eyecom_rc_session',_TTL=30*24*60*60*1000;
function _saveSession(u){try{localStorage.setItem(_SK,JSON.stringify({id:u.id,expires:Date.now()+_TTL}));}catch(e){}}
function _clearSession(){try{localStorage.removeItem(_SK);}catch(e){}}
function _loadSession(){try{var r=localStorage.getItem(_SK);if(!r)return null;var s=JSON.parse(r);if(!s||!s.id||Date.now()>s.expires){_clearSession();return null;}return s;}catch(e){return null;}}

// Override doLogin to save session
var _origDoLogin=doLogin;
doLogin=async function(){
  var u=document.getElementById('lu').value.trim(),p=document.getElementById('lpw').value;
  if(!u||!p){showErr('Please enter username and password.');return;}
  var btn=document.getElementById('login-btn');btn.disabled=true;btn.innerHTML='<span class="spin"></span>Authenticating...';
  try{
    var{data,error}=await sb.from('rc_users').select('*').eq('username',u).eq('password_hash',p).eq('status','active').single();
    if(error||!data){showErr('Invalid credentials. Please try again.');return;}
    CU=data;
    var cb=document.getElementById('keep-cb');
    if(cb&&cb.checked)_saveSession(CU);
    document.getElementById('lp').style.display='none';
    document.getElementById('app').style.display='block';
    await setupUI();
  }catch(e){showErr('Connection error. Please try again.');}
  finally{btn.disabled=false;btn.textContent='ACCESS SYSTEM';}
};

// Override doLogout to clear session
var _origLogout=doLogout;
doLogout=async function(){
  _clearSession();
  await _origLogout();
};

// Auto-login on page load if session exists
(async function tryAutoLogin(){
  var saved=_loadSession();
  if(!saved)return;
  try{
    var{data,error}=await sb.from('rc_users').select('*').eq('id',saved.id).eq('status','active').single();
    if(!error&&data){
      CU=data;
      document.getElementById('lp').style.display='none';
      document.getElementById('app').style.display='block';
      await setupUI();
    } else {_clearSession();}
  }catch(e){_clearSession();}
})();


// =======================================================
//  STOCK SYSTEM
// =======================================================
var allStock=[], allDispatches=[], allLocations=[];
var _selectedLocType='storeroom';
var _dispatchStockId=null;

async function loadStock(){
  var{data}=await sb.from('rc_stock').select('*').order('received_at',{ascending:false});
  allStock=data||[];
}
async function loadDispatches(){
  var{data}=await sb.from('rc_stock_dispatches').select('*').order('dispatched_at',{ascending:false});
  allDispatches=data||[];
}
async function loadLocations(){
  var{data}=await sb.from('rc_dispatch_locations').select('*').eq('is_active',true).order('name');
  allLocations=data||[];
}

// Attach to existing showPage
var _origShowPage=showPage;
showPage=function(n){
  _origShowPage(n);
  if(n==='stock')renderStockPage();
};

// Auto-create stock entry when job is saved
var _origSaveJob=saveJob;
saveJob=async function(){
  var wasEdit=!!editJid;
  var prevQty=wasEdit?(allJobs.find(function(j){return j.id===editJid;})||{qty:0}).qty:0;
  await _origSaveJob.call(this);
  // After job saved, ensure stock entry exists
  var latestJob=allJobs[0]; // freshly loaded
  if(!wasEdit&&latestJob){
    await ensureStockEntry(latestJob);
    await loadStock();
    updateStockNB();
  } else if(wasEdit){
    // Update stock qty if job qty changed
    var updJob=allJobs.find(function(j){return j.id===editJid;});
    if(updJob){
      var stockItem=allStock.find(function(s){return s.job_id===updJob.id;});
      if(stockItem){
        var dispatched=stockItem.qty_dispatched||0;
        var newQtyRecv=updJob.qty;
        var newQtyInStock=Math.max(0,newQtyRecv-dispatched);
        var newStatus=dispatched===0?'in_stock':dispatched>=newQtyRecv?'fully_dispatched':'partially_dispatched';
        await sb.from('rc_stock').update({qty_received:newQtyRecv,qty_in_stock:newQtyInStock,batch:updJob.batch,pitch:updJob.pitch,job_name:updJob.job_name,client:updJob.client,status:newStatus}).eq('id',stockItem.id);
        await loadStock();
      }
    }
  }
};

async function ensureStockEntry(job){
  if(!job||!job.id)return;
  var exists=allStock.find(function(s){return s.job_id===job.id;});
  if(exists)return;
  var{error}=await sb.from('rc_stock').insert({
    job_id:job.id,batch:job.batch||'',pitch:job.pitch||'',
    job_name:job.job_name,client:job.client,
    qty_received:job.qty,qty_in_stock:job.qty,
    received_at:job.created_at||new Date().toISOString(),
    created_by:CU.id
  });
  if(!error)await loadStock();
}

function updateStockNB(){
  var low=allStock.filter(function(s){return s.status==='in_stock'&&s.qty_in_stock>0;}).length;
  var nb=document.getElementById('nb-stock');
  if(nb){nb.textContent=allStock.length;nb.style.display=allStock.length?'':'none';}
}

function stockStatusClass(s){
  var m={in_stock:'stock-status-in',partially_dispatched:'stock-status-partial',fully_dispatched:'stock-status-full',returned:'stock-status-returned'};
  return m[s]||'stock-status-in';
}
function stockStatusLabel(s){
  var m={in_stock:'In Stock',partially_dispatched:'Partial',fully_dispatched:'Dispatched',returned:'Returned'};
  return m[s]||s;
}
function locTypeClass(t){return'loc-'+(t||'other');}
function locTypeBadge(loc){
  if(!loc)return'-';
  var label=loc.type==='client'?'Client: '+(loc.client_name||loc.name):loc.name;
  return'<span class="dispatch-badge '+locTypeClass(loc.type)+'">'+label+'</span>';
}

async function renderStockPage(){
  await Promise.all([loadStock(),loadDispatches(),loadLocations()]);
  var search=(document.getElementById('stock-search').value||'').toLowerCase();
  var sf=document.getElementById('stock-status-filter').value;
  var pf=document.getElementById('stock-pitch-filter').value;
  var items=allStock;
  if(search)items=items.filter(function(s){return s.batch.toLowerCase().includes(search)||s.job_name.toLowerCase().includes(search)||s.client.toLowerCase().includes(search);});
  if(sf)items=items.filter(function(s){return s.status===sf;});
  if(pf)items=items.filter(function(s){return s.pitch===pf;});

  // Summary line
  var totalIn=allStock.filter(function(s){return s.qty_in_stock>0;}).reduce(function(a,s){return a+s.qty_in_stock;},0);
  var totalAll=allStock.reduce(function(a,s){return a+s.qty_received;},0);
  var summLine=document.getElementById('stock-summary-line');
  if(summLine)summLine.textContent=allStock.length+' stock items . '+totalIn+' units in stock . '+totalAll+' total received';

  if(!items.length){
    document.getElementById('stock-content').innerHTML='<div class="empty"><div class="eico">&#128230;</div><p class="etxt">No stock items found</p></div>';
    updateStockNB();return;
  }

  var canEdit=CU&&(CU.is_admin||CU.is_senior);
  document.getElementById('stock-content').innerHTML=items.map(function(s){
    var job=allJobs.find(function(j){return j.id===s.job_id;});
    var pct=s.qty_received>0?Math.round((s.qty_dispatched/s.qty_received)*100):0;
    var barColor=s.status==='fully_dispatched'?'var(--cr)':s.status==='partially_dispatched'?'var(--cy)':'var(--cg)';
    var itemDispatches=allDispatches.filter(function(d){return d.stock_id===s.id;}).slice(0,3);

    var dispRows=itemDispatches.length?itemDispatches.map(function(d){
      var loc=allLocations.find(function(l){return l.id===d.location_id;});
      return '<div class="dispatch-row">'+
        '<div style="flex:1;min-width:0">'+locTypeBadge(loc)+'<span style="font-size:12px;color:var(--tm);margin-left:8px">'+new Date(d.dispatched_at).toLocaleString()+'</span></div>'+
        '<span style="font-family:Rajdhani,sans-serif;font-size:16px;font-weight:700;color:var(--cr)">-'+d.qty+'</span>'+
      '</div>';
    }).join(''):'<div style="font-size:12px;color:var(--tm);padding:6px 0">No dispatches yet</div>';

    return '<div class="stock-card">'+
      '<div class="stock-card-header">'+
        '<div>'+
          '<span style="font-family:Rajdhani,sans-serif;font-size:17px;font-weight:700;color:var(--c1)">'+s.batch+'</span>'+
          '<span style="margin-left:10px;background:rgba(168,85,247,.1);color:var(--cp);padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">'+(s.pitch||'-')+'</span>'+
          '<div style="font-size:13px;color:var(--tp);margin-top:3px">'+s.job_name+'</div>'+
          '<div style="font-size:12px;color:var(--tm)">'+s.client+(job?' . <a onclick="cm(\'m-stock-detail\');viewJob(\'' + s.job_id + '\')" style="color:var(--c1);cursor:pointer">View Job</a>':'')+'</div>'+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
          '<span class="bdg '+stockStatusClass(s.status)+'">'+stockStatusLabel(s.status)+'</span>'+
          (canEdit?'<button class="btn bcyan bsm" onclick="openDispatchFor(\'' + s.id + '\')">&#8599; Dispatch</button>':'')+
          '<button class="btn bout bsm" onclick="openStockDetail(\'' + s.id + '\')">&#128269; Detail</button>'+
        '</div>'+
      '</div>'+
      '<div class="stock-card-body">'+
        '<div class="stock-meta">'+
          '<div class="stock-field"><div class="stock-fval" style="color:var(--cg)">'+s.qty_in_stock+'</div><div class="stock-flbl">In Stock</div></div>'+
          '<div class="stock-field"><div class="stock-fval" style="color:var(--c2)">'+s.qty_dispatched+'</div><div class="stock-flbl">Dispatched</div></div>'+
          '<div class="stock-field"><div class="stock-fval" style="color:var(--c1)">'+s.qty_received+'</div><div class="stock-flbl">Total Received</div></div>'+
          '<div class="stock-field"><div class="stock-fval" style="color:var(--tm)">'+pct+'%</div><div class="stock-flbl">Dispatched</div></div>'+
        '</div>'+
        '<div class="stock-bar-wrap"><div class="stock-bar" style="width:'+pct+'%;background:'+barColor+'"></div></div>'+
        '<div style="font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--tm);margin-bottom:6px">Recent Dispatches</div>'+
        dispRows+
        (allDispatches.filter(function(d){return d.stock_id===s.id;}).length>3?'<div style="font-size:12px;color:var(--c1);cursor:pointer;margin-top:6px" onclick="openStockDetail(\'' + s.id + '\')">View all dispatches...</div>':'')+
      '</div>'+
    '</div>';
  }).join('');
  updateStockNB();
}

// -- DISPATCH FLOW -----------------------------------------
async function openDispatch(){
  await Promise.all([loadStock(),loadLocations()]);
  populateDispatchStockSelect();
  populateDispatchLocSelect();
  document.getElementById('dispatch-qty').value=1;
  document.getElementById('dispatch-ref').value='';
  document.getElementById('dispatch-notes').value='';
  document.getElementById('dispatch-stock-info').style.display='none';
  document.getElementById('dispatch-client-row').style.display='none';
  om('m-dispatch');
}

async function openDispatchFor(stockId){
  await openDispatch();
  document.getElementById('dispatch-stock-id').value=stockId;
  onDispatchStockChange();
}

function populateDispatchStockSelect(){
  var sel=document.getElementById('dispatch-stock-id');
  var available=allStock.filter(function(s){return s.qty_in_stock>0;});
  sel.innerHTML='<option value="">Select stock item...</option>'+
    available.map(function(s){
      return'<option value="'+s.id+'">'+s.batch+' - '+s.job_name+' ('+s.qty_in_stock+' available)</option>';
    }).join('');
}

function populateDispatchLocSelect(selectedId){
  var sel=document.getElementById('dispatch-loc-id');
  sel.innerHTML='<option value="">Select location...</option>'+
    allLocations.map(function(l){
      var label=l.type==='client'?'[Client] '+(l.client_name||l.name):('['+l.type.charAt(0).toUpperCase()+l.type.slice(1)+'] '+l.name);
      return'<option value="'+l.id+'"'+(l.id===selectedId?' selected':'')+'>'+label+'</option>';
    }).join('')+
    '<option value="__new__">+ Add new location...</option>';
}

function onDispatchStockChange(){
  var sid=document.getElementById('dispatch-stock-id').value;
  var infoDiv=document.getElementById('dispatch-stock-info');
  var infoBody=document.getElementById('dispatch-stock-info-body');
  if(!sid){infoDiv.style.display='none';return;}
  var s=allStock.find(function(x){return x.id===sid;});
  if(!s){infoDiv.style.display='none';return;}
  infoBody.innerHTML=
    '<strong>'+s.batch+'</strong> - '+s.job_name+' &nbsp;|&nbsp; Client: '+s.client+
    ' &nbsp;|&nbsp; Pitch: <span style="color:var(--cp)">'+(s.pitch||'-')+'</span>'+
    ' &nbsp;|&nbsp; <span style="color:var(--cg)">'+s.qty_in_stock+' units available</span>';
  infoDiv.style.display='block';
  document.getElementById('dispatch-qty').max=s.qty_in_stock;
  document.getElementById('dispatch-qty').value=Math.min(1,s.qty_in_stock);
}

function onDispatchLocChange(){
  var val=document.getElementById('dispatch-loc-id').value;
  if(val==='__new__'){
    cm('m-dispatch');
    openAddLocation(function(){
      om('m-dispatch');
      populateDispatchLocSelect(allLocations[allLocations.length-1]?.id);
    });
    return;
  }
  var loc=allLocations.find(function(l){return l.id===val;});
  var cr=document.getElementById('dispatch-client-row');
  cr.style.display=(loc&&loc.type==='client'&&!loc.client_name)?'block':'none';
}

function stepDispatchQty(delta){
  var inp=document.getElementById('dispatch-qty');
  var v=(parseInt(inp.value)||1)+delta;
  var max=parseInt(inp.max)||9999;
  inp.value=Math.max(1,Math.min(v,max));
}

async function submitDispatch(){
  var sid=document.getElementById('dispatch-stock-id').value;
  var lid=document.getElementById('dispatch-loc-id').value;
  var qty=parseInt(document.getElementById('dispatch-qty').value)||0;
  var ref=document.getElementById('dispatch-ref').value.trim();
  var notes=document.getElementById('dispatch-notes').value.trim();
  if(!sid){toast('Select a stock item.','error');return;}
  if(!lid||lid==='__new__'){toast('Select a dispatch location.','error');return;}
  if(qty<1){toast('Quantity must be at least 1.','error');return;}
  var s=allStock.find(function(x){return x.id===sid;});
  if(!s||qty>s.qty_in_stock){toast('Insufficient stock ('+( s?s.qty_in_stock:0)+' available).','error');return;}
  var btn=document.getElementById('dispatch-submit-btn');
  btn.disabled=true;btn.innerHTML='<span class="spin"></span>Dispatching...';
  var{error}=await sb.from('rc_stock_dispatches').insert({
    stock_id:sid,
    job_id:s.job_id,
    location_id:lid,
    qty:qty,
    dispatched_by:CU.id,
    reference:ref||null,
    notes:notes||null
  });
  btn.disabled=false;btn.textContent='&#8599; Confirm Dispatch';
  if(error){toast('Error: '+error.message,'error');return;}
  await Promise.all([loadStock(),loadDispatches()]);
  cm('m-dispatch');
  toast(qty+' unit(s) dispatched successfully!','success');
  if(document.getElementById('page-stock').classList.contains('active'))renderStockPage();
  updateStockNB();
}

// -- LOCATION MANAGEMENT ----------------------------------
var _afterLocSave=null;
function openAddLocation(callback){
  _afterLocSave=callback||null;
  _selectedLocType='storeroom';
  document.getElementById('loc-name').value='';
  document.getElementById('loc-client').value='';
  document.getElementById('loc-client-row').style.display='none';
  document.querySelectorAll('.loc-pill').forEach(function(p){p.classList.remove('active');});
  var first=document.querySelector('.loc-pill[data-type="storeroom"]');
  if(first)first.classList.add('active');
  om('m-location');
}

function selectLocType(t){
  _selectedLocType=t;
  document.querySelectorAll('.loc-pill').forEach(function(p){p.classList.toggle('active',p.getAttribute('data-type')===t);});
  document.getElementById('loc-client-row').style.display=t==='client'?'block':'none';
}

async function saveLocation(){
  var name=document.getElementById('loc-name').value.trim();
  var clientName=document.getElementById('loc-client').value.trim();
  if(!name){toast('Enter a location name.','error');return;}
  var{error}=await sb.from('rc_dispatch_locations').insert({
    name:name,type:_selectedLocType,
    client_name:_selectedLocType==='client'?clientName:null,
    created_by:CU.id
  });
  if(error){toast('Error: '+error.message,'error');return;}
  await loadLocations();
  toast('Location added: '+name,'success');
  cm('m-location');
  if(_afterLocSave)_afterLocSave();
}

// -- STOCK DETAIL MODAL -----------------------------------
async function openStockDetail(stockId){
  await Promise.all([loadStock(),loadDispatches(),loadLocations()]);
  var s=allStock.find(function(x){return x.id===stockId;});
  if(!s)return;
  var job=allJobs.find(function(j){return j.id===s.job_id;});
  var dispatches=allDispatches.filter(function(d){return d.stock_id===stockId;});
  var pct=s.qty_received>0?Math.round((s.qty_dispatched/s.qty_received)*100):0;
  var barColor=s.status==='fully_dispatched'?'var(--cr)':s.status==='partially_dispatched'?'var(--cy)':'var(--cg)';

  var canEdit=CU&&(CU.is_admin||CU.is_senior);
  var canEdit=CU&&(CU.is_admin||CU.is_senior);
  document.getElementById('m-stock-detail-ttl').textContent=s.batch+' - '+s.job_name;
  document.getElementById('m-stock-detail-body').innerHTML=
    '<div class="stock-meta" style="margin-bottom:16px">'+
      '<div class="stock-field"><div class="stock-fval" style="color:var(--cg)">'+s.qty_in_stock+'</div><div class="stock-flbl">In Stock</div></div>'+
      '<div class="stock-field"><div class="stock-fval" style="color:var(--c2)">'+s.qty_dispatched+'</div><div class="stock-flbl">Dispatched</div></div>'+
      '<div class="stock-field"><div class="stock-fval" style="color:var(--c1)">'+s.qty_received+'</div><div class="stock-flbl">Received</div></div>'+
      '<div class="stock-field"><div class="stock-fval" style="color:var(--cp)">'+(s.pitch||'-')+'</div><div class="stock-flbl">Pitch</div></div>'+
    '</div>'+
    '<div class="stock-bar-wrap" style="margin-bottom:16px"><div class="stock-bar" style="width:'+pct+'%;background:'+barColor+'"></div></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">'+
      '<div class="dl"><div class="dlb">Client</div><div class="dlv">'+s.client+'</div></div>'+
      '<div class="dl"><div class="dlb">Job</div><div class="dlv">'+(job?job.job_number+' - '+job.job_name:s.job_name)+'</div></div>'+
      '<div class="dl"><div class="dlb">Received</div><div class="dlv">'+new Date(s.received_at).toLocaleString()+'</div></div>'+
      '<div class="dl"><div class="dlb">Status</div><div class="dlv"><span class="bdg '+stockStatusClass(s.status)+'">'+stockStatusLabel(s.status)+'</span></div></div>'+
    '</div>'+
    '<div style="font-family:Rajdhani,sans-serif;font-size:15px;font-weight:700;margin-bottom:12px;color:var(--c1)">Dispatch History ('+dispatches.length+')</div>'+
    (dispatches.length?
      '<div class="dispatch-timeline">'+dispatches.map(function(d){
        var loc=allLocations.find(function(l){return l.id===d.location_id;});
        var dispUser=allUsers.find(function(u){return u.id===d.dispatched_by;});
        return'<div class="dt-item">'+
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
            '<span style="font-family:Rajdhani,sans-serif;font-size:18px;font-weight:700;color:var(--cr)">-'+d.qty+' units</span>'+
            locTypeBadge(loc)+
          '</div>'+
          '<div class="dt-time">'+new Date(d.dispatched_at).toLocaleString()+' by '+(dispUser?dispUser.name:'?')+(d.reference?' . Ref: '+d.reference:'')+'</div>'+
          (d.notes?'<div style="font-size:12px;color:var(--tm);margin-top:3px">'+d.notes+'</div>':'')+
        '</div>';
      }).join('')+'</div>'
    :'<div class="empty" style="padding:20px 0"><p class="etxt">No dispatches yet</p></div>')+
    '<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">'+
      '<button class="btn bcyan" onclick="cm(\'m-stock-detail\');openDispatchFor(\'' + s.id + '\')">&#8599; Dispatch Stock</button>'+
      (job?'<button class="btn bout" onclick="cm(\'m-stock-detail\');viewJob(\'' + s.job_id + '\')">&#128269; View Job</button>':'')+
    '</div>';
  om('m-stock-detail');
}

// Hook into setupUI to load stock data
var _origSetupUI=setupUI;
setupUI=async function(){
  await _origSetupUI.call(this);
  await Promise.all([loadStock(),loadDispatches(),loadLocations()]);
  updateStockNB();
  // Ensure stock entries exist for all current jobs
  for(var i=0;i<allJobs.length;i++){
    await ensureStockEntry(allJobs[i]);
  }
  await loadStock();
  updateStockNB();
};


// ===============================
//  HARD RESET - clears all caches
// ===============================
function hardReset(){
  if(!confirm('This will clear all cached app data and reload. Continue?')) return;
  // Clear localStorage and sessionStorage
  try { localStorage.clear(); } catch(e) {}
  try { sessionStorage.clear(); } catch(e) {}
  // Unregister any service workers
  if('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistrations().then(function(regs){
      regs.forEach(function(reg){ reg.unregister(); });
    });
  }
  // Clear all caches
  if('caches' in window){
    caches.keys().then(function(keys){
      keys.forEach(function(key){ caches.delete(key); });
    });
  }
  // Force reload bypassing cache
  setTimeout(function(){ window.location.reload(true); }, 300);
}


// ==============================================
//  PWA - Service Worker + Install Banner
// ==============================================
var _pwaPrompt = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js')
      .then(function(reg) {
        reg.addEventListener('updatefound', function() {
          var nw = reg.installing;
          nw.addEventListener('statechange', function() {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('App update available - refresh to apply', 'info');
            }
          });
        });
      })
      .catch(function(err) { console.warn('SW registration failed:', err); });
  });
}

window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  _pwaPrompt = e;
  if (!localStorage.getItem('pwa_dismissed')) {
    setTimeout(function() {
      var b = document.getElementById('pwa-banner');
      if (b) b.classList.add('show');
    }, 3000);
  }
});

window.addEventListener('appinstalled', function() {
  _pwaPrompt = null;
  var b = document.getElementById('pwa-banner');
  if (b) b.classList.remove('show');
  localStorage.setItem('pwa_dismissed', '1');
  toast('Eyecom RC installed!', 'success');
});

function installPWA() {
  var b = document.getElementById('pwa-banner');
  if (b) b.classList.remove('show');
  if (_pwaPrompt) {
    _pwaPrompt.prompt();
    _pwaPrompt.userChoice.then(function(r) {
      if (r.outcome === 'accepted') toast('Installing...', 'success');
      _pwaPrompt = null;
    });
  }
}

function dismissPWA() {
  var b = document.getElementById('pwa-banner');
  if (b) b.classList.remove('show');
  localStorage.setItem('pwa_dismissed', '1');
}

(function() {
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent.toLowerCase());
  var isStandalone = window.navigator.standalone === true;
  if (isIOS && !isStandalone && !localStorage.getItem('pwa_dismissed')) {
    setTimeout(function() {
      var b = document.getElementById('pwa-banner');
      if (!b) return;
      var sp = b.querySelector('.pwa-text span');
      if (sp) sp.textContent = 'Tap Share then "Add to Home Screen"';
      b.classList.add('show');
    }, 4000);
  }
})();

// ==============================================
//  DAMAGE LOG SYSTEM
// ==============================================
var allDamageLogs = [];
var _dmgSeverity = 'Medium';
var _dmgPhotoFile = null;
var _dmgPhotoDataUrl = null;

// -- Load damage logs --------------------------
async function loadDamageLogs() {
  var{data} = await sb.from('rc_damage_logs').select('*').order('logged_at', {ascending:false});
  allDamageLogs = data || [];
  updateDamageNB();
}

function updateDamageNB() {
  var nb = document.getElementById('nb-damage');
  if (nb) { nb.textContent = allDamageLogs.length; nb.style.display = allDamageLogs.length ? '' : 'none'; }
}

// -- Render damage page ------------------------
async function renderDamagePage() {
  await loadDamageLogs();
  // Populate job filter
  var jf = document.getElementById('damage-job-filter');
  if (jf) {
    jf.innerHTML = '<option value="">All Jobs</option>' +
      allJobs.map(function(j){ return '<option value="'+j.id+'">'+j.job_number+' - '+j.job_name+'</option>'; }).join('');
  }
  var search = (document.getElementById('damage-search').value || '').toLowerCase();
  var sevF = document.getElementById('damage-sev-filter').value;
  var jobF = document.getElementById('damage-job-filter').value;
  var items = allDamageLogs;
  if (search) items = items.filter(function(d){
    return d.serial_number.toLowerCase().includes(search) ||
           (d.module_code||'').toLowerCase().includes(search) ||
           (d.damage_notes||'').toLowerCase().includes(search);
  });
  if (sevF) items = items.filter(function(d){ return d.severity === sevF; });
  if (jobF) items = items.filter(function(d){ return d.job_id === jobF; });

  // Summary
  var sl = document.getElementById('damage-summary-line');
  if (sl) sl.textContent = allDamageLogs.length + ' entries - ' +
    allDamageLogs.filter(function(d){return d.severity==='Write-off';}).length + ' write-offs';

  if (!items.length) {
    document.getElementById('damage-content').innerHTML = '<div class="empty"><div class="eico">&#9888;</div><p class="etxt">No damage entries found</p></div>';
    return;
  }

  var SUPA_URL = 'https://educbtcexgflpaxvjhwa.supabase.co';
  document.getElementById('damage-content').innerHTML = items.map(function(d) {
    var job = allJobs.find(function(j){ return j.id === d.job_id; });
    var loggedBy = allUsers.find(function(u){ return u.id === d.logged_by; });
    var types = (d.damage_types || []).map(dmgTypeLabel).join(', ') || 'Not specified';
    var sevClass = 'sev-badge-' + d.severity;
    var imgHtml = '';
    if (d.image_url) {
      imgHtml = '<img class="damage-img-thumb" src="' + d.image_url + '" alt="damage" onclick="openLightbox(\'' + d.image_url.replace(/'/g,"\\'") + '\')">';
    }
    return '<div class="damage-card">' +
      '<div class="damage-card-header">' +
        '<div>' +
          '<div style="font-family:Rajdhani,sans-serif;font-size:16px;font-weight:700;color:var(--c1)">' + escHtml(d.serial_number) + '</div>' +
          (d.module_code ? '<div style="font-size:12px;color:var(--tm)">Code: ' + escHtml(d.module_code) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<span class="bdg ' + sevClass + '">' + d.severity + '</span>' +
          (job ? '<span class="chip">&#128196; ' + job.job_number + '</span>' : '') +
          '<button class="btn bcyan bsm" onclick="openEditDamage(\'' + d.id + '\')">&#9998; Edit</button>' +
          '<button class="btn bout bsm" onclick="openDamageDetail(\'' + d.id + '\')">&#128269; Detail</button>' +
          (CU&&(CU.is_admin||CU.is_senior) ? '<button class="btn bdanger bsm" onclick="deleteDamageLog(\'' + d.id + '\')">&#128465;</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="damage-card-body">' +
        '<div class="damage-meta-grid">' +
          '<div class="dl"><div class="dlb">Damage Types</div><div class="dlv" style="font-size:12px">' + escHtml(types) + '</div></div>' +
          '<div class="dl"><div class="dlb">Logged By</div><div class="dlv">' + (loggedBy ? loggedBy.name : '?') + '</div></div>' +
          '<div class="dl"><div class="dlb">Date &amp; Time</div><div class="dlv" style="font-size:12px">' + new Date(d.logged_at).toLocaleString() + '</div></div>' +
          (d.damage_notes ? '<div class="dl"><div class="dlb">Notes</div><div class="dlv" style="font-size:12px">' + escHtml(d.damage_notes) + '</div></div>' : '') +
        '</div>' +
        (imgHtml ? '<div style="display:flex;align-items:flex-start;gap:10px">' + imgHtml + '</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function dmgTypeLabel(t) {
  var m = {pixel_lt3:'<3 Pixel',pixel_gt3:'>3 Pixel',track:'Track Damage',chip:'Chip Fault',
           physical:'Physical',water:'Water Damage',burn:'Burn Mark',ber:'B.E.R',other:'Other'};
  return m[t] || t;
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// -- Open log damage modal ---------------------
async function openLogDamage() {
  // Reset to NEW mode
  document.getElementById('dmg-edit-id').value = '';
  document.getElementById('dmg-modal-title').textContent = 'Log Damaged Module';
  document.getElementById('dmg-submit-btn').innerHTML = '&#10003; Log Damage';
  document.getElementById('dmg-edit-note').style.display = 'none';

  ['dmg-serial','dmg-code','dmg-notes'].forEach(function(id){ document.getElementById(id).value = ''; });
  document.querySelectorAll('.dtype-chip').forEach(function(c){ c.classList.remove('selected'); });
  _dmgSeverity = 'Medium';
  document.querySelectorAll('.sev-pill').forEach(function(p){
    p.classList.toggle('active', p.getAttribute('data-sev') === 'Medium');
  });
  _dmgPhotoFile = null;
  _dmgPhotoDataUrl = null;
  document.getElementById('dmg-photo-preview').style.display = 'none';
  document.getElementById('dmg-photo-preview').src = '';
  document.getElementById('dmg-drop-zone').style.display = '';
  document.getElementById('dmg-photo-clear-row').style.display = 'none';
  document.getElementById('dmg-photo-input').value = '';

  var js2 = document.getElementById('dmg-job');
  js2.innerHTML = '<option value="">No job reference</option>' +
    allJobs.map(function(j){ return '<option value="'+j.id+'">'+j.job_number+' - '+j.job_name+' ('+j.client+')</option>'; }).join('');

  om('m-damage');
}

// -- Damage type toggle ------------------------
function toggleDmgType(el) {
  el.classList.toggle('selected');
}

// -- Severity select ---------------------------
function selectSeverity(sev) {
  _dmgSeverity = sev;
  document.querySelectorAll('.sev-pill').forEach(function(p){
    p.classList.toggle('active', p.getAttribute('data-sev') === sev);
  });
}

// -- Photo handling ----------------------------
function dmgDragOver(e) { e.preventDefault(); document.getElementById('dmg-drop-zone').classList.add('drag-over'); }
function dmgDragLeave(e) { document.getElementById('dmg-drop-zone').classList.remove('drag-over'); }
function dmgDrop(e) {
  e.preventDefault();
  document.getElementById('dmg-drop-zone').classList.remove('drag-over');
  var file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) processDmgPhoto(file);
}
function dmgPhotoSelected(e) {
  var file = e.target.files[0];
  if (file) processDmgPhoto(file);
}
function processDmgPhoto(file) {
  if (file.size > 5242880) { toast('Image must be under 5MB','error'); return; }
  _dmgPhotoFile = file;
  var reader = new FileReader();
  reader.onload = function(e2) {
    _dmgPhotoDataUrl = e2.target.result;
    var preview = document.getElementById('dmg-photo-preview');
    preview.src = _dmgPhotoDataUrl;
    preview.style.display = '';
    document.getElementById('dmg-drop-zone').style.display = 'none';
    document.getElementById('dmg-photo-name').textContent = file.name;
    document.getElementById('dmg-photo-clear-row').style.display = 'flex';
  };
  reader.readAsDataURL(file);
}
function clearDmgPhoto() {
  _dmgPhotoFile = null; _dmgPhotoDataUrl = null;
  document.getElementById('dmg-photo-preview').style.display = 'none';
  document.getElementById('dmg-photo-preview').src = '';
  document.getElementById('dmg-drop-zone').style.display = '';
  document.getElementById('dmg-photo-clear-row').style.display = 'none';
  document.getElementById('dmg-photo-input').value = '';
}

// -- Open edit damage modal -------------------
async function openEditDamage(id) {
  var d = allDamageLogs.find(function(x){ return x.id === id; });
  if (!d) { toast('Entry not found', 'error'); return; }

  // Switch modal to EDIT mode
  document.getElementById('dmg-edit-id').value = id;
  document.getElementById('dmg-modal-title').textContent = 'Edit Damage Entry';
  document.getElementById('dmg-submit-btn').innerHTML = '&#10003; Save Changes';
  document.getElementById('dmg-edit-note').style.display = 'inline';

  // Populate fields
  document.getElementById('dmg-serial').value = d.serial_number || '';
  document.getElementById('dmg-code').value   = d.module_code   || '';
  document.getElementById('dmg-notes').value  = d.damage_notes  || '';

  // Damage type chips
  document.querySelectorAll('.dtype-chip').forEach(function(c){
    var type = c.getAttribute('data-type');
    c.classList.toggle('selected', (d.damage_types || []).indexOf(type) >= 0);
  });

  // Severity
  _dmgSeverity = d.severity || 'Medium';
  document.querySelectorAll('.sev-pill').forEach(function(p){
    p.classList.toggle('active', p.getAttribute('data-sev') === _dmgSeverity);
  });

  // Job reference
  var js2 = document.getElementById('dmg-job');
  js2.innerHTML = '<option value="">No job reference</option>' +
    allJobs.map(function(j){ return '<option value="'+j.id+'">'+j.job_number+' - '+j.job_name+' ('+j.client+')</option>'; }).join('');
  js2.value = d.job_id || '';

  // Existing photo
  _dmgPhotoFile = null;
  _dmgPhotoDataUrl = null;
  if (d.image_url) {
    document.getElementById('dmg-photo-preview').src = d.image_url;
    document.getElementById('dmg-photo-preview').style.display = '';
    document.getElementById('dmg-drop-zone').style.display = 'none';
    document.getElementById('dmg-photo-name').textContent = d.image_name || 'existing photo';
    document.getElementById('dmg-photo-clear-row').style.display = 'flex';
  } else {
    document.getElementById('dmg-photo-preview').style.display = 'none';
    document.getElementById('dmg-photo-preview').src = '';
    document.getElementById('dmg-drop-zone').style.display = '';
    document.getElementById('dmg-photo-clear-row').style.display = 'none';
  }
  document.getElementById('dmg-photo-input').value = '';

  om('m-damage');
}

function submitDamageLog() {
  var editId  = document.getElementById('dmg-edit-id').value.trim();
  var isEdit  = editId.length > 0;
  var serial  = document.getElementById('dmg-serial').value.trim();
  if (!serial) { toast('Serial number is required', 'error'); return; }
  var types = Array.from(document.querySelectorAll('.dtype-chip.selected')).map(function(el){ return el.getAttribute('data-type'); });
  if (!types.length) { toast('Select at least one damage type', 'error'); return; }

  var btn = document.getElementById('dmg-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>' + (isEdit ? 'Saving...' : 'Logging...');

  (async function() {
    try {
      var imageUrl  = null;
      var imageName = null;

      // If editing, start with existing image values
      if (isEdit) {
        var existing = allDamageLogs.find(function(x){ return x.id === editId; });
        if (existing) { imageUrl = existing.image_url; imageName = existing.image_name; }
      }

      // New photo selected - upload it
      if (_dmgPhotoFile) {
        // Delete old image if replacing
        if (isEdit && imageName) {
          await sb.storage.from('damage-images').remove([imageName]);
        }
        var ext = _dmgPhotoFile.name.split('.').pop();
        imageName = 'dmg-' + Date.now() + '-' + serial.replace(/[^a-zA-Z0-9]/g,'_') + '.' + ext;
        var upResult = await sb.storage.from('damage-images').upload(imageName, _dmgPhotoFile, {
          cacheControl: '3600', upsert: false, contentType: _dmgPhotoFile.type
        });
        if (upResult.error) {
          toast('Photo upload failed: ' + upResult.error.message, 'error');
          imageName = isEdit ? (allDamageLogs.find(function(x){return x.id===editId;})||{}).image_name : null;
          imageUrl  = isEdit ? (allDamageLogs.find(function(x){return x.id===editId;})||{}).image_url  : null;
        } else {
          var urlResult = sb.storage.from('damage-images').getPublicUrl(imageName);
          imageUrl = urlResult.data.publicUrl;
        }
      }

      // Photo was cleared by user (preview hidden, drop zone visible, no new file)
      var dropZoneVisible = document.getElementById('dmg-drop-zone').style.display !== 'none';
      if (!_dmgPhotoFile && dropZoneVisible && isEdit) {
        var existingEntry = allDamageLogs.find(function(x){ return x.id === editId; });
        if (existingEntry && existingEntry.image_name) {
          await sb.storage.from('damage-images').remove([existingEntry.image_name]);
        }
        imageUrl  = null;
        imageName = null;
      }

      var payload = {
        serial_number: serial,
        module_code:   document.getElementById('dmg-code').value.trim()  || null,
        job_id:        document.getElementById('dmg-job').value           || null,
        damage_types:  types,
        severity:      _dmgSeverity,
        damage_notes:  document.getElementById('dmg-notes').value.trim() || null,
        image_url:     imageUrl,
        image_name:    imageName,
        updated_at:    new Date().toISOString()
      };

      var result;
      if (isEdit) {
        result = await sb.from('rc_damage_logs').update(payload).eq('id', editId);
      } else {
        payload.logged_by = CU.id;
        result = await sb.from('rc_damage_logs').insert(payload);
      }

      if (result.error) { toast('Error: ' + result.error.message, 'error'); return; }

      await loadDamageLogs();
      cm('m-damage');
      toast(isEdit ? 'Entry updated successfully!' : 'Damage logged successfully!', 'success');
      if (document.getElementById('page-damage').classList.contains('active')) renderDamagePage();

    } finally {
      btn.disabled = false;
      btn.innerHTML = '&#10003; ' + (isEdit ? 'Save Changes' : 'Log Damage');
    }
  })();
}

// -- Delete damage log -------------------------
async function deleteDamageLog(id) {
  if (!confirm('Delete this damage log entry?')) return;
  var entry = allDamageLogs.find(function(d){ return d.id === id; });
  if (entry && entry.image_name) {
    await sb.storage.from('damage-images').remove([entry.image_name]);
  }
  var{error} = await sb.from('rc_damage_logs').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  await loadDamageLogs();
  toast('Entry deleted', 'info');
  if (document.getElementById('page-damage').classList.contains('active')) renderDamagePage();
}

// -- Damage detail modal -----------------------
function openDamageDetail(id) {
  var d = allDamageLogs.find(function(x){ return x.id === id; });
  if (!d) return;
  var job = allJobs.find(function(j){ return j.id === d.job_id; });
  var loggedBy = allUsers.find(function(u){ return u.id === d.logged_by; });
  var types = (d.damage_types||[]).map(dmgTypeLabel).join(', ') || 'Not specified';

  document.getElementById('m-dmg-detail-title').textContent = 'Damage: ' + d.serial_number;
  document.getElementById('m-dmg-detail-body').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
      '<div class="dl"><div class="dlb">Serial Number</div><div class="dlv" style="color:var(--c1);font-family:Rajdhani,sans-serif;font-size:18px;font-weight:700">' + escHtml(d.serial_number) + '</div></div>' +
      '<div class="dl"><div class="dlb">Module Code</div><div class="dlv">' + escHtml(d.module_code || '-') + '</div></div>' +
      '<div class="dl"><div class="dlb">Severity</div><div class="dlv"><span class="bdg sev-badge-'+d.severity+'">'+d.severity+'</span></div></div>' +
      '<div class="dl"><div class="dlb">Linked Job</div><div class="dlv">' + (job ? '<span class="chip">'+job.job_number+' - '+job.job_name+'</span>' : '<span style="color:var(--tm)">None</span>') + '</div></div>' +
      '<div class="dl"><div class="dlb">Damage Types</div><div class="dlv" style="font-size:12px">' + escHtml(types) + '</div></div>' +
      '<div class="dl"><div class="dlb">Logged By</div><div class="dlv">' + (loggedBy ? loggedBy.name : '?') + '</div></div>' +
      '<div class="dl full" style="grid-column:1/-1"><div class="dlb">Date &amp; Time</div><div class="dlv">' + new Date(d.logged_at).toLocaleString() + '</div></div>' +
      (d.damage_notes ? '<div class="dl" style="grid-column:1/-1"><div class="dlb">Notes</div><div class="dlv">' + escHtml(d.damage_notes) + '</div></div>' : '') +
    '</div>' +
    (d.image_url ?
      '<div style="margin-bottom:14px"><div class="dlb" style="margin-bottom:8px">Photo</div>' +
      '<img src="' + d.image_url + '" style="max-width:100%;border-radius:8px;border:1px solid var(--bdr);cursor:zoom-in" onclick="openLightbox(\'' + d.image_url.replace(/'/g,"\\'") + '\')" alt="damage photo"></div>'
    : '') +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn bcyan" onclick="cm(\'m-damage-detail\');downloadSingleDamagePDF(\'' + d.id + '\')">&#8659; Download Report</button>' +
      (job ? '<button class="btn bout" onclick="cm(\'m-damage-detail\');viewJob(\''+d.job_id+'\')">&#128269; View Job</button>' : '') +
    '</div>';
  om('m-damage-detail');
}

// -- Lightbox ----------------------------------
function openLightbox(url) {
  document.getElementById('lightbox-img').src = url;
  document.getElementById('img-lightbox').classList.add('open');
}

// -- QR/Barcode Scanner ------------------------





// SCANNER STATE
var _scanStream      = null;
var _scanRAF         = null;
var _scanCanvas      = null;
var _scanCtx         = null;
var _lastScanTime    = 0;
var _scannerTargetId = null;
var _torchOn         = false;

async function openScanner(targetInputId) {
  _scannerTargetId = targetInputId;

  var statusEl = document.getElementById('scan-status');
  var manualEl = document.getElementById('scan-manual-input');
  var overlay  = document.getElementById('scan-overlay');
  var video    = document.getElementById('scan-video');

  if (manualEl) manualEl.value = '';
  if (statusEl) statusEl.textContent = 'Starting camera...';
  overlay.classList.add('open');

  // Stop any previous stream safely
  _stopScan();

  // Check libraries
  var jsqrOk   = typeof jsQR   !== 'undefined';
  var quaggaOk = typeof Quagga !== 'undefined';
  if (!jsqrOk && !quaggaOk) {
    if (statusEl) statusEl.textContent = 'Scanner unavailable - use manual entry below';
    toast('Scanner libraries not loaded. Use manual entry.', 'error');
    return;
  }

  // Set up canvas
  _scanCanvas = document.getElementById('scan-canvas');
  _scanCtx    = _scanCanvas ? _scanCanvas.getContext('2d', {willReadFrequently:true}) : null;

  try {
    _scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720} },
      audio: false
    });

    video.srcObject = _scanStream;

    await new Promise(function(resolve) {
      video.onloadedmetadata = resolve;
      setTimeout(resolve, 3000);
    });
    await video.play();

    if (statusEl) statusEl.textContent = 'Scanning - point camera at code';
    _decodeTick(video, statusEl, jsqrOk, quaggaOk);

  } catch(err) {
    _stopScan();
    overlay.classList.remove('open');
    var name = (err && err.name) ? err.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      toast('Camera permission denied. Please allow camera access and try again.', 'error');
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      toast('No camera found on this device. Use manual entry.', 'error');
    } else {
      toast('Camera error: ' + ((err && err.message) || name || 'unknown') + '. Use manual entry.', 'error');
    }
  }
}














function _canvasToDataUrl() {
  try { return (_scanCanvas) ? _scanCanvas.toDataURL('image/png') : null; } catch(e) { return null; }
}

function _decodeTick(video, statusEl, jsqrOk, quaggaOk) {
  if (!_scanStream) return; // stopped

  var now = Date.now();
  // Throttle to ~10 fps for battery
  if (now - _lastScanTime >= 100) {
    _lastScanTime = now;

    try {
      if (video.readyState === video.HAVE_ENOUGH_DATA && _scanCanvas && _scanCtx) {
        var w = video.videoWidth;
        var h = video.videoHeight;
        if (w > 0 && h > 0) {
          _scanCanvas.width  = w;
          _scanCanvas.height = h;
          _scanCtx.drawImage(video, 0, 0, w, h);

          var imageData = _scanCtx.getImageData(0, 0, w, h);

          // -- QR codes via jsQR ----------------------------------------
          if (jsqrOk) {
            var qr = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
            if (qr && qr.data) {
              _onScanResult(qr.data);
              return;
            }
          }

          // -- 1D barcodes via Quagga2 ----------------------------------
          if (quaggaOk) {
            Quagga.decodeSingle({
              decoder: {
                readers: ['code_128_reader','ean_reader','ean_8_reader',
                          'code_39_reader','code_39_vin_reader','codabar_reader',
                          'upc_reader','upc_e_reader','i2of5_reader']
              },
              locate: true,
              src: _canvasToDataUrl()
            }, function(result) {
              if (result && result.codeResult && result.codeResult.code) {
                _onScanResult(result.codeResult.code);
              }
            });
          }
        }
      }
    } catch(e) {
      // Silent - decode errors are expected when no code is visible
    }
  }

  _scanRAF = requestAnimationFrame(function() {
    _decodeTick(video, statusEl, jsqrOk, quaggaOk);
  });
}



function _onScanResult(text) {
  if (!text || !text.trim()) return;
  _stopScan();
  document.getElementById('scan-overlay').classList.remove('open');
  var inp = document.getElementById(_scannerTargetId);
  if (inp) { inp.value = text.trim(); inp.focus(); }
  toast('Scanned: ' + text.trim(), 'success');
}

function _stopScan() {
  if (_scanRAF) { cancelAnimationFrame(_scanRAF); _scanRAF = null; }
  if (_scanStream) {
    try { _scanStream.getTracks().forEach(function(t){ t.stop(); }); } catch(e) {}
    _scanStream = null;
  }
  _torchOn = false;
  try {
    var video = document.getElementById('scan-video');
    if (video) video.srcObject = null;
  } catch(e) {}
}

function closeScanner() {
  _stopScan();
  document.getElementById('scan-overlay').classList.remove('open');
  var statusEl = document.getElementById('scan-status');
  if (statusEl) statusEl.textContent = 'Starting camera...';
  var manualEl = document.getElementById('scan-manual-input');
  if (manualEl) manualEl.value = '';
}

async function toggleTorch() {
  if (!_scanStream) { toast('Start the scanner first', 'info'); return; }
  var track = _scanStream.getVideoTracks()[0];
  if (!track) return;
  try {
    _torchOn = !_torchOn;
    await track.applyConstraints({ advanced: [{ torch: _torchOn }] });
    var tb = document.getElementById('torch-btn');
    if (tb) tb.style.color = _torchOn ? 'var(--cy)' : '';
  } catch(e) {
    toast('Torch not supported on this device', 'info');
    _torchOn = false;
  }
}










function scanManualEntry() {
  var val = (document.getElementById('scan-manual-input').value || '').trim();
  if (!val) { toast('Please enter a code first', 'error'); return; }
  closeScanner();
  var inp = document.getElementById(_scannerTargetId);
  if (inp) { inp.value = val; inp.focus(); }
  toast('Code set: ' + val, 'success');
}














// -- PDF Reports -------------------------------
function openDamageReport() {
  var today = new Date().toISOString().slice(0,10);
  var monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
  document.getElementById('dmg-rep-from').value = monthStart;
  document.getElementById('dmg-rep-to').value = today;
  var rj = document.getElementById('dmg-rep-job');
  rj.innerHTML = '<option value="">All Jobs</option>' +
    allJobs.map(function(j){ return '<option value="'+j.id+'">'+j.job_number+' - '+j.job_name+'</option>'; }).join('');
  document.getElementById('dmg-rep-sev').value = '';
  om('m-damage-report');
}

function downloadDamagePDF() {
  var from = document.getElementById('dmg-rep-from').value;
  var to   = document.getElementById('dmg-rep-to').value;
  var jobF = document.getElementById('dmg-rep-job').value;
  var sevF = document.getElementById('dmg-rep-sev').value;
  var items = allDamageLogs;
  if (from) items = items.filter(function(d){ return d.logged_at >= from; });
  if (to)   items = items.filter(function(d){ return d.logged_at <= to + 'T23:59:59'; });
  if (jobF) items = items.filter(function(d){ return d.job_id === jobF; });
  if (sevF) items = items.filter(function(d){ return d.severity === sevF; });
  if (!items.length) { toast('No entries for selected filters', 'error'); return; }
  cm('m-damage-report');
  generateDamagePDF(items, from || 'All', to || 'All');
}

function downloadSingleDamagePDF(id) {
  var d = allDamageLogs.find(function(x){ return x.id === id; });
  if (!d) return;
  generateDamagePDF([d], d.logged_at.slice(0,10), d.logged_at.slice(0,10));
}

function generateDamagePDF(items, fromDate, toDate) {
  if (typeof window.jspdf === 'undefined') { toast('PDF library loading, try again', 'info'); return; }

  // -- Determine if this is a single-job report ---------------------------
  var jobIds = {};
  items.forEach(function(d){ if(d.job_id) jobIds[d.job_id] = true; });
  var isSingleJob = Object.keys(jobIds).length === 1 && Object.keys(jobIds)[0];
  var focusJob    = isSingleJob ? allJobs.find(function(j){ return j.id === isSingleJob; }) : null;
  var focusStock  = isSingleJob ? allStock.filter(function(s){ return s.job_id === isSingleJob; }) : [];

  // -- Job module count logic ----------------------------------------------
  // Source of truth for "booked in": rc_jobs.qty (set when job was created)
  // Also cross-check rc_stock.qty_received if available
  var jobQtyBooked  = focusJob ? (focusJob.qty || 0) : 0;
  var stockReceived = focusStock.reduce(function(s,r){ return s + (r.qty_received||0); }, 0);
  // Use whichever is higher as the authoritative booked count
  var totalBooked   = Math.max(jobQtyBooked, stockReceived);
  var totalDamaged  = items.length;
  var totalUndamaged = Math.max(0, totalBooked - totalDamaged);
  var damageRate     = totalBooked > 0 ? ((totalDamaged / totalBooked) * 100).toFixed(1) : '0.0';

  var doc = new window.jspdf.jsPDF({orientation:'portrait', unit:'mm', format:'a4'});
  var W=210, M=14, H=297;

  // Colours
  var BG_PAGE  = [10, 13, 20];
  var BG_HEADER= [17, 24, 39];
  var BG_BAND  = [26, 34, 52];
  var CYAN     = [0, 212, 255];
  var RED      = [255, 51, 85];
  var AMBER    = [255, 204, 0];
  var GREEN    = [0, 255, 136];
  var PURPLE   = [168, 85, 247];
  var ORANGE   = [255, 107, 0];
  var TXT_PRI  = [232, 234, 240];
  var TXT_MUT  = [120, 133, 153];
  var BORDER   = [30, 42, 65];

  // -- PAGE 1 BACKGROUND --------------------------------------------------
  doc.setFillColor.apply(doc, BG_PAGE);
  doc.rect(0, 0, W, H, 'F');

  // -- HEADER BAND --------------------------------------------------------
  doc.setFillColor.apply(doc, BG_HEADER);
  doc.rect(0, 0, W, 28, 'F');
  doc.setFillColor.apply(doc, RED);
  doc.rect(0, 0, 3, 28, 'F');
  doc.setFillColor.apply(doc, RED);
  doc.circle(M+5, 14, 4.5, 'F');
  doc.setFillColor.apply(doc, BG_PAGE);
  doc.circle(M+5, 14, 2, 'F');

  doc.setFont('helvetica','bold');
  doc.setFontSize(13);
  doc.setTextColor.apply(doc, TXT_PRI);
  doc.text('EYECOM LED SOLUTIONS - DAMAGE LOG REPORT', M+14, 11);
  doc.setFont('helvetica','normal');
  doc.setFontSize(8);
  doc.setTextColor.apply(doc, RED);
  doc.text(isSingleJob && focusJob
    ? 'Job Reference: ' + focusJob.job_number + ' - ' + focusJob.job_name
    : 'All Jobs - Period: ' + fromDate + ' to ' + toDate,
    M+14, 17.5);
  doc.setFontSize(7);
  doc.setTextColor.apply(doc, TXT_MUT);
  doc.text('Generated: ' + new Date().toLocaleString() + '   |   ' + items.length + ' damage entries', W-M, 23, {align:'right'});

  var y = 34;

  // ========================================================================
  // JOB INFO SECTION (only when single job is referenced)
  // ========================================================================
  if (focusJob) {
    // Section header
    doc.setFillColor.apply(doc, BG_BAND);
    doc.rect(M, y, W-M*2, 8, 'F');
    doc.setFillColor.apply(doc, RED);
    doc.rect(M, y, 2.5, 8, 'F');
    doc.setFont('helvetica','bold');
    doc.setFontSize(7.5);
    doc.setTextColor.apply(doc, TXT_PRI);
    doc.text('JOB INFORMATION', M+6, y+5.3);
    y += 10;

    // Two-column job detail grid
    var assignedUser = allUsers.find(function(u){ return u.id === focusJob.assigned_to; });
    var jobDetails = [
      ['Job Number',   focusJob.job_number || '-'],
      ['Job Name',     focusJob.job_name   || '-'],
      ['Client',       focusJob.client     || '-'],
      ['Batch',        focusJob.batch      || '-'],
      ['Pitch',        focusJob.pitch      || '-'],
      ['Status',       focusJob.status     || '-'],
      ['Priority',     focusJob.priority   || '-'],
      ['Assigned To',  assignedUser ? assignedUser.name : 'Unassigned'],
    ];

    var colW = (W - M*2 - 4) / 2;
    var rowH = 7;
    jobDetails.forEach(function(pair, i) {
      var col = i % 2;
      var row = Math.floor(i / 2);
      var cx  = M + col * (colW + 4);
      var cy  = y + row * rowH;
      doc.setFillColor.apply(doc, col === 0 ? BG_BAND : BG_PAGE);
      doc.rect(cx, cy, colW, rowH, 'F');
      doc.setFont('helvetica','normal');
      doc.setFontSize(6.5);
      doc.setTextColor.apply(doc, TXT_MUT);
      doc.text(pair[0].toUpperCase(), cx+3, cy+4.2);
      doc.setFont('helvetica','bold');
      doc.setTextColor.apply(doc, TXT_PRI);
      doc.text(String(pair[1]), cx+colW*0.4, cy+4.2);
    });
    y += Math.ceil(jobDetails.length / 2) * rowH + 4;

    // Notes if present
    if (focusJob.notes && focusJob.notes.trim()) {
      doc.setFillColor.apply(doc, BG_BAND);
      doc.rect(M, y, W-M*2, 7, 'F');
      doc.setFont('helvetica','normal');
      doc.setFontSize(6.5);
      doc.setTextColor.apply(doc, TXT_MUT);
      doc.text('JOB NOTES', M+3, y+4.5);
      doc.setTextColor.apply(doc, TXT_PRI);
      doc.text(focusJob.notes.slice(0,200), M+30, y+4.5);
      y += 9;
    }

    y += 4;

    // ======================================================================
    // MODULE HEALTH SUMMARY CARDS
    // ======================================================================
    doc.setFillColor.apply(doc, BG_BAND);
    doc.rect(M, y, W-M*2, 8, 'F');
    doc.setFillColor.apply(doc, GREEN);
    doc.rect(M, y, 2.5, 8, 'F');
    doc.setFont('helvetica','bold');
    doc.setFontSize(7.5);
    doc.setTextColor.apply(doc, TXT_PRI);
    doc.text('MODULE HEALTH SUMMARY', M+6, y+5.3);
    y += 10;

    var healthCards = [
      { l:'Booked In',   v: totalBooked,     c: CYAN   },
      { l:'Undamaged',   v: totalUndamaged,  c: GREEN  },
      { l:'Damaged',     v: totalDamaged,    c: RED    },
      { l:'Damage Rate', v: damageRate + '%',c: AMBER, small: true },
      { l:'Write-offs',  v: items.filter(function(d){return d.severity==='Write-off';}).length, c: PURPLE }
    ];
    var cw = (W - M*2 - 4) / healthCards.length;
    var ch = 18;
    healthCards.forEach(function(s, i) {
      var cx = M + i * (cw + 1);
      doc.setFillColor.apply(doc, BG_BAND);
      doc.roundedRect(cx, y, cw, ch, 1.5, 1.5, 'F');
      doc.setFillColor.apply(doc, s.c);
      doc.roundedRect(cx, y, cw, 2.5, 1, 0, 'F');
      doc.rect(cx, y+1.5, cw, 1, 'F');
      doc.setFont('helvetica','bold');
      doc.setFontSize(s.small ? 9 : 13);
      doc.setTextColor.apply(doc, s.c);
      doc.text(String(s.v), cx+cw/2, y+11, {align:'center'});
      doc.setFont('helvetica','normal');
      doc.setFontSize(5);
      doc.setTextColor.apply(doc, TXT_MUT);
      doc.text(s.l.toUpperCase(), cx+cw/2, y+16, {align:'center'});
    });
    y += ch + 4;

    // Stock breakdown if available
    if (focusStock.length > 0) {
      y += 2;
      doc.setFillColor.apply(doc, BG_BAND);
      doc.rect(M, y, W-M*2, 8, 'F');
      doc.setFillColor.apply(doc, CYAN);
      doc.rect(M, y, 2.5, 8, 'F');
      doc.setFont('helvetica','bold');
      doc.setFontSize(7.5);
      doc.setTextColor.apply(doc, TXT_PRI);
      doc.text('STOCK RECORD', M+6, y+5.3);
      y += 10;

      var stockRows = focusStock.map(function(s) {
        return [s.batch || '-', s.pitch || '-',
          String(s.qty_received||0), String(s.qty_in_stock||0),
          String(s.qty_dispatched||0), s.status||'-'];
      });

      doc.autoTable({
        startY: y,
        head: [['Batch','Pitch','Received','In Stock','Dispatched','Status']],
        body: stockRows,
        theme: 'grid',
        headStyles: {fillColor:BG_BAND,textColor:CYAN,fontSize:6.5,fontStyle:'bold',lineColor:BORDER,lineWidth:0.3},
        bodyStyles: {fillColor:BG_PAGE,textColor:TXT_PRI,fontSize:7,lineColor:BORDER,lineWidth:0.2},
        alternateRowStyles: {fillColor:BG_BAND},
        columnStyles: {
          2:{halign:'center',textColor:CYAN},
          3:{halign:'center',textColor:GREEN},
          4:{halign:'center',textColor:AMBER},
          5:{halign:'center'}
        },
        margin: {left:M, right:M},
        tableLineColor: BORDER, tableLineWidth: 0.3
      });
      y = doc.lastAutoTable.finalY + 8;
    } else {
      y += 4;
    }
  } else {
    // Multi-job: simple stat cards
    var sevCounts = {Low:0,Medium:0,High:0,'Write-off':0};
    items.forEach(function(d){ if(sevCounts[d.severity]!==undefined) sevCounts[d.severity]++; });
    var scards = [
      {l:'Total',v:items.length,c:RED},
      {l:'Low',v:sevCounts.Low,c:GREEN},
      {l:'Medium',v:sevCounts.Medium,c:AMBER},
      {l:'High',v:sevCounts.High,c:RED},
      {l:'Write-off',v:sevCounts['Write-off'],c:PURPLE}
    ];
    var cw2 = (W-M*2-4)/scards.length;
    scards.forEach(function(s,i){
      var cx=M+i*(cw2+1);
      doc.setFillColor.apply(doc,BG_BAND);
      doc.roundedRect(cx,y,cw2,16,1.5,1.5,'F');
      doc.setFillColor.apply(doc,s.c);
      doc.roundedRect(cx,y,cw2,2,1,0,'F');
      doc.rect(cx,y+1,cw2,1,'F');
      doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor.apply(doc,s.c);
      doc.text(String(s.v),cx+cw2/2,y+9.5,{align:'center'});
      doc.setFont('helvetica','normal');doc.setFontSize(5.5);doc.setTextColor.apply(doc,TXT_MUT);
      doc.text(s.l.toUpperCase(),cx+cw2/2,y+14,{align:'center'});
    });
    y += 20;
  }

  // ========================================================================
  // DAMAGE LOG TABLE
  // ========================================================================
  doc.setFillColor.apply(doc, BG_BAND);
  doc.rect(M, y, W-M*2, 8, 'F');
  doc.setFillColor.apply(doc, RED);
  doc.rect(M, y, 2.5, 8, 'F');
  doc.setFont('helvetica','bold');
  doc.setFontSize(7.5);
  doc.setTextColor.apply(doc, TXT_PRI);
  doc.text('DAMAGE LOG ENTRIES (' + items.length + ')', M+6, y+5.3);
  y += 10;

  var tableRows = items.map(function(d) {
    var job      = allJobs.find(function(j){ return j.id === d.job_id; });
    var loggedBy = allUsers.find(function(u){ return u.id === d.logged_by; });
    return [
      d.serial_number,
      d.module_code || '-',
      isSingleJob ? null : (job ? job.job_number : '-'),
      (d.damage_types||[]).map(dmgTypeLabel).join(', ') || '-',
      d.severity,
      loggedBy ? loggedBy.name : '?',
      new Date(d.logged_at).toLocaleDateString(),
      (d.damage_notes||'-').slice(0,50)
    ].filter(function(v){ return v !== null; });
  });

  var heads = ['Serial #','Module Code'];
  if (!isSingleJob) heads.push('Job');
  heads = heads.concat(['Damage Types','Severity','Logged By','Date','Notes']);

  var colStyles = {
    0:{fontStyle:'bold',textColor:CYAN},
    3:{fontSize:5.5},
    5:{textColor:TXT_MUT}
  };
  var sevCol = isSingleJob ? 3 : 4;
  colStyles[sevCol] = {halign:'center'};

  doc.autoTable({
    startY: y,
    head: [heads],
    body: tableRows,
    theme: 'grid',
    headStyles: {fillColor:BG_BAND,textColor:RED,fontSize:6.5,fontStyle:'bold',lineColor:BORDER,lineWidth:0.3},
    bodyStyles: {fillColor:BG_PAGE,textColor:TXT_PRI,fontSize:6.5,lineColor:BORDER,lineWidth:0.2},
    alternateRowStyles: {fillColor:BG_BAND},
    columnStyles: colStyles,
    didParseCell: function(data) {
      if (data.section === 'body' && data.column.index === sevCol) {
        var sev = data.cell.raw;
        if (sev==='Low')         data.cell.styles.textColor = GREEN;
        else if (sev==='Medium') data.cell.styles.textColor = AMBER;
        else if (sev==='High')   data.cell.styles.textColor = RED;
        else if (sev==='Write-off') data.cell.styles.textColor = PURPLE;
      }
    },
    margin: {left:M, right:M},
    tableLineColor: BORDER, tableLineWidth: 0.3
  });

  // -- FOOTER ON EVERY PAGE ------------------------------------------------
  var pageCount = doc.getNumberOfPages();
  for (var p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFillColor.apply(doc, BG_HEADER);
    doc.rect(0, H-8, W, 8, 'F');
    doc.setFillColor.apply(doc, RED);
    doc.rect(0, H-8, W, 0.5, 'F');
    doc.setFont('helvetica','normal');
    doc.setFontSize(6);
    doc.setTextColor.apply(doc, TXT_MUT);
    doc.text('EYECOM LED SOLUTIONS - DAMAGE LOG REPORT | Confidential', M, H-3);
    doc.text('Page ' + p + ' of ' + pageCount, W-M, H-3, {align:'right'});
  }

  doc.save('eyecom-damage-' + (focusJob ? focusJob.job_number + '-' : '') + fromDate + '-to-' + toDate + '.pdf');
  toast('Damage report downloaded!', 'success');
}

// Hook into setupUI
var _origSetupUIDmg = setupUI;
setupUI = async function() {
  await _origSetupUIDmg.call(this);
  await loadDamageLogs();
};

// Hook into showPage
var _origShowPageDmg = showPage;
showPage = function(n) {
  _origShowPageDmg(n);
  if (n === 'damage') renderDamagePage();
};






// ==============================================
//  PROGRAMMING TABLE  (Batch Records)
// ==============================================
var allProgramming   = [];
var allPermissions   = [];
var allReceiverCards = [];
var _progRcfgxFile   = null;
var _progRcfgxKeep   = true;
var _progTab         = 'batch';   // 'batch' | 'rcvr'

// -- Receiver card firmware state
var _rcvrFwFile      = null;
var _currentRcvrId   = null;

// Fetch all programming data
async function loadProgramming() {
  var isPriv = CU && (CU.is_admin || CU.is_senior);
  var res = await sb.from('rc_programming').select('*').order('batch_number');
  var all = res.data || [];
  // Attach receiver card links to each programming record
  var rcvrLinksRes = await sb.from('rc_programming_receiver_cards')
    .select('programming_id, receiver_card_id, firmware_id');
  var allRcvrLinks = rcvrLinksRes.data || [];
  all.forEach(function(p) {
    p._rcvr_cards = allRcvrLinks
      .filter(function(l){ return l.programming_id === p.id; })
      .map(function(l){
        var card = allReceiverCards.find(function(c){ return c.id === l.receiver_card_id; });
        return card ? Object.assign({}, card, {_firmware_id: l.firmware_id}) : null;
      })
      .filter(Boolean);
  });

  if (!isPriv) {
    var vres = await sb.from('rc_programming_visibility').select('programming_id').eq('user_id', CU.id);
    var allowed = new Set((vres.data || []).map(function(v){ return v.programming_id; }));
    var vAll = await sb.from('rc_programming_visibility').select('programming_id');
    var restricted = new Set((vAll.data || []).map(function(v){ return v.programming_id; }));
    var perm = allPermissions.find(function(p){ return p.user_id === CU.id; });
    if (perm && !perm.can_view_programming) { allProgramming = []; return; }
    allProgramming = all.filter(function(p) {
      if (!restricted.has(p.id)) return true;
      return allowed.has(p.id);
    });
  } else {
    allProgramming = all;
  }
}

async function loadReceiverCards() {
  var res = await sb.from('rc_receiver_cards').select('*').order('name');
  allReceiverCards = res.data || [];
}

// Switch between Batch / Receiver Cards tabs
function switchProgTab(tab) {
  _progTab = tab;
  document.getElementById('tab-batch').classList.toggle('active', tab === 'batch');
  document.getElementById('tab-rcvr').classList.toggle('active', tab === 'rcvr');
  // Update tab border styling
  ['batch','rcvr'].forEach(function(t) {
    var el = document.getElementById('tab-' + t);
    if (el) {
      el.style.borderBottomColor = t === tab ? 'var(--c1)' : 'transparent';
      el.style.color = t === tab ? 'var(--c1)' : 'var(--tm)';
    }
  });
  // Show/hide pitch filter (only relevant for batch tab)
  var pf = document.getElementById('prog-pitch-filter');
  if (pf) pf.style.display = tab === 'batch' ? '' : 'none';
  renderProgrammingPage();
}

// Main render
async function renderProgrammingPage() {
  var isPriv = CU && (CU.is_admin || CU.is_senior);
  var adminBtns = document.getElementById('prog-admin-btns');
  if (adminBtns) adminBtns.style.display = (isPriv || userCan('can_add_programming_records') || userCan('can_upload_programming_files')) ? 'flex' : 'none';

  await loadProgramming();
  await loadReceiverCards();

  var search = (document.getElementById('prog-search').value || '').toLowerCase();

  if (_progTab === 'batch') {
    renderBatchTab(search, isPriv);
  } else {
    renderReceiverCardsTab(search, isPriv);
  }
}

function renderBatchTab(search, isPriv) {
  var pitchF = document.getElementById('prog-pitch-filter').value;
  var items  = allProgramming;
  if (search) items = items.filter(function(p) {
    return p.batch_number.toLowerCase().includes(search) ||
           (p.driver_chip||'').toLowerCase().includes(search) ||
           (p.decoder_chip||'').toLowerCase().includes(search) ||
           (p.pitch||'').toLowerCase().includes(search) ||
           (p.notes||'').toLowerCase().includes(search);
  });
  if (pitchF) items = items.filter(function(p){ return p.pitch === pitchF; });

  var sl = document.getElementById('prog-summary-line');
  if (sl) sl.textContent = allProgramming.length + ' batch records, ' + allReceiverCards.length + ' receiver card types';

  if (!items.length) {
    document.getElementById('prog-content').innerHTML =
      '<div class="empty"><div class="eico">&#128190;</div><p class="etxt">No batch records found</p></div>';
    return;
  }

  document.getElementById('prog-content').innerHTML = items.map(function(p) {
    var creator  = allUsers.find(function(u){ return u.id === p.created_by; });
    var rcvrLinks = (p._rcvr_cards || []);
    var rcfgxBtn = p.rcfgx_url
      ? '<a href="' + p.rcfgx_url + '" download="' + (p.rcfgx_name||'config.rcfgx') + '" class="file-dl-btn">&#8659; RCFGX<span style="font-size:10px;color:var(--tm);margin-left:4px">' + fmtFileSize(p.rcfgx_size) + '</span></a>'
      : '<span class="file-dl-btn no-file">&#8659; RCFGX</span>';
    var canEditProg   = isPriv || userCan('can_edit_programming_records');
    var canDeleteProg = isPriv || userCan('can_delete_programming_records');
    var adminBtns2 = (canEditProg || canDeleteProg)
      ? (canEditProg   ? '<button class="btn bcyan bsm" onclick="openEditProgramming(\'' + p.id + '\')">&#9998; Edit</button>' : '') +
        (canDeleteProg ? '<button class="btn bdanger bsm" onclick="deleteProgramming(\'' + p.id + '\')">&#128465;</button>' : '')
      : '';
    return '<div class="prog-card">' +
      '<div class="prog-card-hd">' +
        '<div>' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<div class="prog-batch">' + escHtml(p.batch_number) + '</div>' +
            (p.pitch ? '<span style="background:rgba(168,85,247,.12);color:var(--cp);padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">' + p.pitch + '</span>' : '') +
          '</div>' +
          '<div style="font-size:11px;color:var(--tm);margin-top:2px">Added ' + new Date(p.created_at).toLocaleDateString() + (creator ? ' by ' + creator.name : '') + '</div>' +
        '</div>' +
        '<div class="prog-chips">' +
          '<span class="prog-chip-item">Driver: ' + escHtml(p.driver_chip) + '</span>' +
          '<span class="prog-chip-item">Decoder: ' + escHtml(p.decoder_chip) + '</span>' +
          (rcvrLinks.length ? rcvrLinks.map(function(c){ return '<span class="prog-chip-item" style="background:rgba(0,255,136,.08);color:var(--cg);border-color:rgba(0,255,136,.2)">&#128190; ' + escHtml(c.name) + '</span>'; }).join('') : '') +
        '</div>' +
        '<div style="display:flex;gap:6px">' + adminBtns2 + '</div>' +
      '</div>' +
      '<div class="prog-card-bd">' +
        rcfgxBtn +
        rcvrLinks.map(function(c){ return '<button class="file-dl-btn" onclick="openReceiverCardDetail(\'' + c.id + '\')">&#128190; ' + escHtml(c.name) + ' Firmware</button>'; }).join('') +
        (p.notes ? '<span style="font-size:12px;color:var(--tm);margin-left:8px">' + escHtml(p.notes) + '</span>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

// Receiver cards tab
function renderReceiverCardsTab(search, isPriv) {
  var cards = allReceiverCards;
  if (search) cards = cards.filter(function(c) {
    return c.name.toLowerCase().includes(search) ||
           (c.manufacturer||'').toLowerCase().includes(search) ||
           (c.model_number||'').toLowerCase().includes(search);
  });

  if (!cards.length) {
    document.getElementById('prog-content').innerHTML =
      '<div class="empty"><div class="eico">&#128190;</div><p class="etxt">No receiver cards found</p>' +
      ((isPriv || userCan('can_add_programming_records')) ? '<button class="btn bcyan" onclick="openAddReceiverCard()" style="margin-top:12px">+ Add First Receiver Card</button>' : '') +
      '</div>';
    return;
  }

  document.getElementById('prog-content').innerHTML = cards.map(function(c) {
    var batchCount = allProgramming.filter(function(p){ return (p._rcvr_cards||[]).some(function(rc){ return rc.id === c.id; }); }).length;
    return '<div class="prog-card">' +
      '<div class="prog-card-hd">' +
        '<div>' +
          '<div class="prog-batch">' + escHtml(c.name) + '</div>' +
          '<div style="font-size:11px;color:var(--tm);margin-top:2px">' +
            (c.manufacturer ? c.manufacturer + ' ' : '') + (c.model_number ? '| Model: ' + c.model_number : '') +
          '</div>' +
        '</div>' +
        '<div class="prog-chips">' +
          (c.max_pixels_w ? '<span class="prog-chip-item">' + c.max_pixels_w + ' x ' + c.max_pixels_h + ' px</span>' : '') +
          '<span class="prog-chip-item" style="background:rgba(168,85,247,.08);color:var(--cp)">' + batchCount + ' batch' + (batchCount!==1?'es':'') + '</span>' +
        '</div>' +
        ((isPriv || userCan('can_edit_programming_records') || userCan('can_delete_programming_records'))
          ? '<div style="display:flex;gap:6px">' +
              ((isPriv || userCan('can_edit_programming_records'))   ? '<button class="btn bcyan bsm" onclick="openEditReceiverCard(\'' + c.id + '\')">&#9998; Edit</button>' : '') +
              ((isPriv || userCan('can_delete_programming_records')) ? '<button class="btn bdanger bsm" onclick="deleteReceiverCard(\'' + c.id + '\')">&#128465;</button>' : '') +
            '</div>'
          : '') +
      '</div>' +
      '<div class="prog-card-bd">' +
        '<button class="file-dl-btn" onclick="openReceiverCardDetail(\'' + c.id + '\')">&#128187; View Firmware (' + c.id + ')</button>' +
        (c.notes ? '<span style="font-size:12px;color:var(--tm);margin-left:8px">' + escHtml(c.notes) + '</span>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function fmtFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1048576).toFixed(1) + ' MB';
}

//    Open receiver cards library                                            
async function openReceiverCards() {
  await loadReceiverCards();
  await renderReceiverCardsList();
  om('m-receiver-cards');
}

async function renderReceiverCardsList() {
  var cont = document.getElementById('rcvr-cards-list');
  if (!allReceiverCards.length) {
    cont.innerHTML = '<div class="empty"><div class="eico">&#128190;</div><p class="etxt">No receiver cards yet</p></div>';
    return;
  }
  cont.innerHTML = allReceiverCards.map(function(c) {
    var batchCount = allProgramming.filter(function(p){ return (p._rcvr_cards||[]).some(function(rc){ return rc.id === c.id; }); }).length;
    return '<div class="prog-card" style="margin-bottom:8px">' +
      '<div class="prog-card-hd">' +
        '<div><div class="prog-batch">' + escHtml(c.name) + '</div>' +
        '<div style="font-size:11px;color:var(--tm)">' + (c.manufacturer||'') + (c.model_number?' | '+c.model_number:'') + '</div></div>' +
        '<div class="prog-chips">' +
          (c.max_pixels_w?'<span class="prog-chip-item">'+c.max_pixels_w+' x '+c.max_pixels_h+' px</span>':'') +
          '<span class="prog-chip-item">' + batchCount + ' batches</span>' +
        '</div>' +
        '<div style="display:flex;gap:6px">' +
          '<button class="btn bcyan bsm" onclick="openReceiverCardDetail(\'' + c.id + '\')">&#128187; Firmware</button>' +
          (isPriv || userCan('can_edit_programming_records')   ? '<button class="btn bout bsm" onclick="openEditReceiverCard(\'' + c.id + '\')">&#9998;</button>' : '') +
          (isPriv || userCan('can_delete_programming_records') ? '<button class="btn bdanger bsm" onclick="deleteReceiverCard(\'' + c.id + '\')">&#128465;</button>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

//    Add / Edit receiver card                                               
function openAddReceiverCard() {
  document.getElementById('rcvr-card-edit-id').value = '';
  document.getElementById('rcvr-card-modal-title').textContent = 'Add Receiver Card';
  ['rcvr-card-name','rcvr-card-mfr','rcvr-card-model','rcvr-card-notes'].forEach(function(id){
    document.getElementById(id).value = '';
  });
  document.getElementById('rcvr-card-pw').value = '';
  document.getElementById('rcvr-card-ph').value = '';
  om('m-receiver-card-edit');
}

function openEditReceiverCard(id) {
  var c = allReceiverCards.find(function(x){ return x.id === id; });
  if (!c) return;
  document.getElementById('rcvr-card-edit-id').value = id;
  document.getElementById('rcvr-card-modal-title').textContent = 'Edit Receiver Card';
  document.getElementById('rcvr-card-name').value  = c.name || '';
  document.getElementById('rcvr-card-mfr').value   = c.manufacturer || '';
  document.getElementById('rcvr-card-model').value = c.model_number || '';
  document.getElementById('rcvr-card-notes').value = c.notes || '';
  document.getElementById('rcvr-card-pw').value    = c.max_pixels_w || '';
  document.getElementById('rcvr-card-ph').value    = c.max_pixels_h || '';
  om('m-receiver-card-edit');
}

async function submitReceiverCard() {
  var editId = document.getElementById('rcvr-card-edit-id').value.trim();
  var name   = document.getElementById('rcvr-card-name').value.trim();
  if (!name) { toast('Card name is required', 'error'); return; }
  var btn = document.getElementById('rcvr-card-submit-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Saving...';
  try {
    var payload = {
      name:          name,
      manufacturer:  document.getElementById('rcvr-card-mfr').value.trim() || null,
      model_number:  document.getElementById('rcvr-card-model').value.trim() || null,
      notes:         document.getElementById('rcvr-card-notes').value.trim() || null,
      max_pixels_w:  parseInt(document.getElementById('rcvr-card-pw').value) || null,
      max_pixels_h:  parseInt(document.getElementById('rcvr-card-ph').value) || null,
      updated_at:    new Date().toISOString()
    };
    var res;
    if (editId) {
      res = await sb.from('rc_receiver_cards').update(payload).eq('id', editId);
    } else {
      payload.created_by = CU.id;
      res = await sb.from('rc_receiver_cards').insert(payload);
    }
    if (res.error) { toast('Error: ' + res.error.message, 'error'); return; }
    await loadReceiverCards();
    cm('m-receiver-card-edit');
    await renderReceiverCardsList();
    toast(editId ? 'Card updated!' : 'Card added!', 'success');
    if (document.getElementById('page-programming').classList.contains('active')) renderProgrammingPage();
  } finally {
    btn.disabled = false; btn.textContent = 'Save Card';
  }
}

async function deleteReceiverCard(id) {
  if (!confirm('Delete this receiver card? All associated firmware files will also be deleted.')) return;
  // Get firmware files for cleanup
  var fwRes = await sb.from('rc_receiver_card_firmware').select('file_name').eq('receiver_card_id', id);
  var fwFiles = (fwRes.data || []).map(function(f){ return f.file_name; });
  if (fwFiles.length) await sb.storage.from('programming-files').remove(fwFiles);
  await sb.from('rc_receiver_card_firmware').delete().eq('receiver_card_id', id);
  var res = await sb.from('rc_receiver_cards').delete().eq('id', id);
  if (res.error) { toast('Error: ' + res.error.message, 'error'); return; }
  await loadReceiverCards();
  await renderReceiverCardsList();
  toast('Receiver card deleted', 'info');
  if (document.getElementById('page-programming').classList.contains('active')) renderProgrammingPage();
}

// Quick add from programming modal
function openAddReceiverCardInline() {
  document.getElementById('rcvr-quick-name').value  = '';
  document.getElementById('rcvr-quick-mfr').value   = '';
  document.getElementById('rcvr-quick-model').value = '';
  om('m-rcvr-quick-add');
}

async function submitQuickReceiverCard() {
  var name = document.getElementById('rcvr-quick-name').value.trim();
  if (!name) { toast('Card name is required', 'error'); return; }
  var res = await sb.from('rc_receiver_cards').insert({
    name:         name,
    manufacturer: document.getElementById('rcvr-quick-mfr').value.trim() || null,
    model_number: document.getElementById('rcvr-quick-model').value.trim() || null,
    created_by:   CU.id
  }).select().single();
  if (res.error) { toast('Error: ' + res.error.message, 'error'); return; }

  var newCard = res.data;
  await loadReceiverCards();
  populateRcvrCardSelect();

  // Immediately add the new card to the current batch
  if (newCard) addRcvrCardRow(newCard.id, null);

  cm('m-rcvr-quick-add');
  toast(name + ' added and selected. Upload firmware from the card row below.', 'success');

  // After a short delay, offer to go to firmware upload
  if (newCard) {
    setTimeout(function() {
      if (confirm('Upload firmware for ' + newCard.name + ' now?')) {
        openReceiverCardDetail(newCard.id);
      }
    }, 350);
  }
}


//    Multi-receiver-card state                                              
// _progRcvrRows = [{receiver_card_id, firmware_id, notes}]
var _progRcvrRows = [];

function populateRcvrCardSelect() {
  // Populate the "add card" dropdown (exclude cards already added)
  var sel = document.getElementById('prog-rcvr-add-select');
  if (!sel) return;
  var usedIds = _progRcvrRows.map(function(r){ return r.receiver_card_id; });
  sel.innerHTML = '<option value="">Select a receiver card to add...</option>' +
    allReceiverCards
      .filter(function(c){ return usedIds.indexOf(c.id) < 0; })
      .map(function(c){
        return '<option value="' + c.id + '">' + c.name +
          (c.manufacturer ? ' - ' + c.manufacturer : '') + '</option>';
      }).join('');
}

function addRcvrCardRow(cardId, firmwareId) {
  var sel = document.getElementById('prog-rcvr-add-select');
  var id  = cardId || (sel && sel.value);
  if (!id) { toast('Select a receiver card first', 'error'); return; }
  // Prevent duplicates
  if (_progRcvrRows.find(function(r){ return r.receiver_card_id === id; })) {
    toast('That receiver card is already added', 'info');
    return;
  }
  _progRcvrRows.push({ receiver_card_id: id, firmware_id: firmwareId || null });
  if (sel) sel.value = '';
  renderRcvrCardRows();
  populateRcvrCardSelect();
}

function removeRcvrCardRow(cardId) {
  _progRcvrRows = _progRcvrRows.filter(function(r){ return r.receiver_card_id !== cardId; });
  renderRcvrCardRows();
  populateRcvrCardSelect();
}

async function renderRcvrCardRows() {
  var cont = document.getElementById('prog-rcvr-cards-list');
  if (!cont) return;
  if (!_progRcvrRows.length) {
    cont.innerHTML = '<div style="font-size:12px;color:var(--tm);padding:4px 0">No receiver cards added yet.</div>';
    return;
  }
  // Build rows - for each card fetch its firmware versions
  var rows = await Promise.all(_progRcvrRows.map(async function(row) {
    var card = allReceiverCards.find(function(c){ return c.id === row.receiver_card_id; });
    if (!card) return '';
    // Get firmware versions for this card
    var fwRes = await sb.from('rc_receiver_card_firmware')
      .select('id,version,is_latest,description')
      .eq('receiver_card_id', row.receiver_card_id)
      .order('uploaded_at', {ascending:false});
    var fwList = fwRes.data || [];
    var fwOptions = '<option value="">No specific version</option>' +
      fwList.map(function(f){
        return '<option value="' + f.id + '"' +
          (f.id === row.firmware_id ? ' selected' : '') +
          '>' + f.version + (f.is_latest ? ' (Latest)' : '') +
          (f.description ? ' - ' + f.description.slice(0,40) : '') + '</option>';
      }).join('');
    return '<div class="prog-rcvr-row" data-card-id="' + card.id + '">' +
      '<div class="prog-rcvr-row-hd">' +
        '<span class="prog-rcvr-row-name">&#128190; ' + escHtml(card.name) +
          (card.manufacturer ? '<span style="font-weight:400;color:var(--tm);font-size:11px;margin-left:6px">' + escHtml(card.manufacturer) + '</span>' : '') +
        '</span>' +
        '<button class="btn bdanger bsm" onclick="removeRcvrCardRow(\'' + card.id + '\')" title="Remove">&#10005;</button>' +
      '</div>' +
      (fwList.length ?
        '<div>' +
          '<div style="font-size:11px;color:var(--tm);margin-bottom:4px">Firmware version for this batch:</div>' +
          '<select class="prog-rcvr-fw-select" data-card-id="' + card.id + '" onchange="updateRcvrFirmware(\'' + card.id + '\',this.value)">' +
          fwOptions +
          '</select>' +
        '</div>'
      : '<div style="font-size:11px;color:var(--tm)">No firmware uploaded for this card yet. ' +
          '<a style="color:var(--c1);cursor:pointer" onclick="openReceiverCardDetail(\'' + card.id + '\')">Upload firmware</a>' +
        '</div>'
      ) +
    '</div>';
  }));
  cont.innerHTML = rows.join('');
}

function updateRcvrFirmware(cardId, firmwareId) {
  var row = _progRcvrRows.find(function(r){ return r.receiver_card_id === cardId; });
  if (row) row.firmware_id = firmwareId || null;
}

async function openAddProgramming() {
  document.getElementById('prog-edit-id').value = '';
  document.getElementById('prog-modal-title').textContent = 'Add Batch Record';
  document.getElementById('prog-submit-btn').textContent  = 'Save Record';
  ['prog-batch','prog-driver','prog-decoder','prog-notes'].forEach(function(id){
    document.getElementById(id).value = '';
  });
  document.getElementById('prog-pitch').value = '';
  _progRcfgxFile = null; _progRcfgxKeep = true;
  resetProgFileZone('rcfgx');
  document.getElementById('prog-rcfgx-existing').style.display = 'none';
  _progRcvrRows = [];
  populateRcvrCardSelect();
  await renderRcvrCardRows();

  // Visibility: only show for admins/seniors
  var isPriv = CU && (CU.is_admin || CU.is_senior);
  var visSection = document.getElementById('prog-visibility-section');
  if (visSection) visSection.style.display = isPriv ? '' : 'none';
  if (isPriv) await buildTechCheckboxes(null);

  var _canUpload = isPriv || userCan('can_upload_programming_files');
  var _rcfgxSection = document.getElementById('prog-rcfgx-zone') &&
    document.getElementById('prog-rcfgx-zone').closest('.fg2');
  if (_rcfgxSection) _rcfgxSection.style.display = _canUpload ? '' : 'none';
  om('m-programming');
}

async function openEditProgramming(id) {
  var p = allProgramming.find(function(x){ return x.id === id; });
  if (!p) return;
  document.getElementById('prog-edit-id').value = id;
  document.getElementById('prog-modal-title').textContent = 'Edit Batch Record';
  document.getElementById('prog-submit-btn').textContent  = 'Save Changes';
  document.getElementById('prog-batch').value   = p.batch_number || '';
  document.getElementById('prog-pitch').value   = p.pitch        || '';
  document.getElementById('prog-driver').value  = p.driver_chip  || '';
  document.getElementById('prog-decoder').value = p.decoder_chip || '';
  document.getElementById('prog-notes').value   = p.notes        || '';
  _progRcfgxFile = null; _progRcfgxKeep = true;
  resetProgFileZone('rcfgx');
  document.getElementById('prog-rcfgx-existing').style.display = 'none';
  if (p.rcfgx_name) {
    document.getElementById('prog-rcfgx-label').textContent = p.rcfgx_name;
    document.getElementById('prog-rcfgx-zone').classList.add('has-file');
    document.getElementById('prog-rcfgx-existing').style.display = '';
    document.getElementById('prog-rcfgx-existing').innerHTML =
      'Current: <strong>' + p.rcfgx_name + '</strong> (' + fmtFileSize(p.rcfgx_size) + ') ' +
      '<button class="btn bdanger bsm" onclick="clearProgFile(\'rcfgx\')">Remove</button>';
  }

  // Load existing receiver card links for this batch
  var linkRes = await sb.from('rc_programming_receiver_cards')
    .select('receiver_card_id, firmware_id')
    .eq('programming_id', id);
  _progRcvrRows = (linkRes.data || []).map(function(r){
    return { receiver_card_id: r.receiver_card_id, firmware_id: r.firmware_id || null };
  });
  populateRcvrCardSelect();
  await renderRcvrCardRows();

  // Visibility: only show for admins/seniors
  var isPriv = CU && (CU.is_admin || CU.is_senior);
  var visSection = document.getElementById('prog-visibility-section');
  if (visSection) visSection.style.display = isPriv ? '' : 'none';
  if (isPriv) {
    var vres = await sb.from('rc_programming_visibility').select('user_id').eq('programming_id', id);
    await buildTechCheckboxes((vres.data||[]).map(function(v){ return v.user_id; }));
  }

  var _canUpload = isPriv || userCan('can_upload_programming_files');
  var _rcfgxSection = document.getElementById('prog-rcfgx-zone') &&
    document.getElementById('prog-rcfgx-zone').closest('.fg2');
  if (_rcfgxSection) _rcfgxSection.style.display = _canUpload ? '' : 'none';
  om('m-programming');
}

async function submitProgramming() {
  var editId  = document.getElementById('prog-edit-id').value.trim();
  var isEdit  = editId.length > 0;
  var batch   = document.getElementById('prog-batch').value.trim();
  var driver  = document.getElementById('prog-driver').value.trim();
  var decoder = document.getElementById('prog-decoder').value.trim();
  if (!batch)   { toast('Batch number is required', 'error'); return; }
  if (!driver)  { toast('Driver chip is required',  'error'); return; }
  if (!decoder) { toast('Decoder chip is required', 'error'); return; }

  var btn = document.getElementById('prog-submit-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Saving...';

  try {
    var existing = isEdit ? allProgramming.find(function(x){ return x.id === editId; }) : null;

    // Upload RCFGX if new file selected
    var rcfgxUrl  = isEdit ? (existing||{}).rcfgx_url  : null;
    var rcfgxName = isEdit ? (existing||{}).rcfgx_name : null;
    var rcfgxSize = isEdit ? (existing||{}).rcfgx_size : null;
    if (_progRcfgxFile) {
      if (isEdit && rcfgxName) await sb.storage.from('programming-files').remove([rcfgxName]);
      var fn = 'prog-rcfgx-' + Date.now() + '-' + _progRcfgxFile.name;
      var up = await sb.storage.from('programming-files').upload(fn, _progRcfgxFile,
        {contentType:'application/octet-stream', upsert:false});
      if (!up.error) {
        rcfgxUrl  = sb.storage.from('programming-files').getPublicUrl(fn).data.publicUrl;
        rcfgxName = fn; rcfgxSize = _progRcfgxFile.size;
      } else { toast('RCFGX upload failed: ' + up.error.message, 'error'); }
    } else if (!_progRcfgxKeep && isEdit && rcfgxName) {
      await sb.storage.from('programming-files').remove([rcfgxName]);
      rcfgxUrl = null; rcfgxName = null; rcfgxSize = null;
    }

    var payload = {
      batch_number: batch,
      pitch:        document.getElementById('prog-pitch').value || null,
      driver_chip:  driver,
      decoder_chip: decoder,
      notes:        document.getElementById('prog-notes').value.trim() || null,
      rcfgx_url:    rcfgxUrl, rcfgx_name: rcfgxName, rcfgx_size: rcfgxSize,
      updated_at:   new Date().toISOString()
    };

    var res;
    if (isEdit) {
      res = await sb.from('rc_programming').update(payload).eq('id', editId);
    } else {
      payload.created_by = CU.id;
      res = await sb.from('rc_programming').insert(payload).select().single();
    }
    if (res.error) { toast('Error: ' + res.error.message, 'error'); return; }

    var progId = isEdit ? editId : (res.data||{}).id;

    // Save receiver card links (replace all)
    if (progId) {
      await sb.from('rc_programming_receiver_cards').delete().eq('programming_id', progId);
      if (_progRcvrRows.length) {
        await sb.from('rc_programming_receiver_cards').insert(
          _progRcvrRows.map(function(r){
            return {
              programming_id:   progId,
              receiver_card_id: r.receiver_card_id,
              firmware_id:      r.firmware_id || null
            };
          })
        );
      }

      // Save visibility (admin/senior only)
      var isPriv = CU && (CU.is_admin || CU.is_senior);
      if (isPriv) {
        await sb.from('rc_programming_visibility').delete().eq('programming_id', progId);
        var checks = Array.from(
          document.querySelectorAll('#prog-tech-checkboxes input[type=checkbox]:checked')
        );
        if (checks.length) {
          await sb.from('rc_programming_visibility').insert(
            checks.map(function(c){
              return {programming_id: progId, user_id: c.value, granted_by: CU.id};
            })
          );
        }
      }
    }

    cm('m-programming');
    toast(isEdit ? 'Record updated!' : 'Record added!', 'success');
    await renderProgrammingPage();
  } finally {
    btn.disabled = false;
    btn.textContent = document.getElementById('prog-edit-id').value ? 'Save Changes' : 'Save Record';
  }
}


//    Receiver card detail + firmware                                       
async function openReceiverCardDetail(cardId) {
  _currentRcvrId = cardId;
  var c = allReceiverCards.find(function(x){ return x.id === cardId; });
  if (!c) return;
  var isPriv = CU && (CU.is_admin || CU.is_senior);
  document.getElementById('rcvr-detail-title').textContent = c.name;
  document.getElementById('rcvr-add-fw-btn').style.display = (isPriv || userCan('can_upload_programming_files')) ? '' : 'none';
  document.getElementById('rcvr-fw-upload-form').style.display = 'none';
  document.getElementById('rcvr-detail-info').innerHTML =
    '<div class="damage-meta-grid">' +
      (c.manufacturer?'<div class="dl"><div class="dlb">Manufacturer</div><div class="dlv">'+escHtml(c.manufacturer)+'</div></div>':'') +
      (c.model_number?'<div class="dl"><div class="dlb">Model</div><div class="dlv">'+escHtml(c.model_number)+'</div></div>':'') +
      (c.max_pixels_w?'<div class="dl"><div class="dlb">Max Resolution</div><div class="dlv">'+c.max_pixels_w+' x '+c.max_pixels_h+' px</div></div>':'') +
      (c.notes?'<div class="dl"><div class="dlb">Notes</div><div class="dlv">'+escHtml(c.notes)+'</div></div>':'') +
    '</div>';
  await renderFirmwareList(cardId);
  om('m-receiver-card-detail');
}

async function renderFirmwareList(cardId) {
  var res = await sb.from('rc_receiver_card_firmware')
    .select('*').eq('receiver_card_id', cardId).order('uploaded_at', {ascending:false});
  var fw = res.data || [];
  var isPriv = CU && (CU.is_admin || CU.is_senior);
  var cont = document.getElementById('rcvr-firmware-list');
  if (!fw.length) {
    cont.innerHTML = '<div style="text-align:center;padding:20px;color:var(--tm);font-size:13px">No firmware uploaded yet</div>';
    return;
  }
  cont.innerHTML = fw.map(function(f) {
    var uploader = allUsers.find(function(u){ return u.id === f.uploaded_by; });
    return '<div class="fw-row">' +
      '<div style="flex:1">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">' +
          '<span class="fw-version-badge">' + escHtml(f.version) + '</span>' +
          (f.is_latest ? '<span class="fw-latest-badge">LATEST</span>' : '') +
        '</div>' +
        (f.description ? '<div style="font-size:12px;color:var(--tm)">' + escHtml(f.description) + '</div>' : '') +
        '<div style="font-size:11px;color:var(--tm);margin-top:2px">' +
          fmtFileSize(f.file_size) + (uploader ? ' &middot; Uploaded by ' + uploader.name : '') +
          ' &middot; ' + new Date(f.uploaded_at).toLocaleDateString() +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<a href="' + f.file_url + '" download="' + escHtml(f.file_name) + '" class="file-dl-btn">&#8659; Download</a>' +
        ((isPriv || userCan('can_delete_programming_records')) ? '<button class="btn bdanger bsm" onclick="deleteFirmware(\'' + f.id + '\',\'' + f.file_name + '\')">&#128465;</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function openAddFirmware() {
  document.getElementById('rcvr-fw-version').value = '';
  document.getElementById('rcvr-fw-desc').value    = '';
  document.getElementById('rcvr-fw-latest').checked = false;
  document.getElementById('rcvr-fw-label').textContent = 'Click to upload firmware file';
  document.getElementById('rcvr-fw-zone').classList.remove('has-file');
  document.getElementById('rcvr-fw-input').value = '';
  _rcvrFwFile = null;
  document.getElementById('rcvr-fw-upload-form').style.display = '';
  document.getElementById('rcvr-fw-upload-form').scrollIntoView({behavior:'smooth',block:'start'});
}

function rcvrFwFileSelected(event) {
  var file = event.target.files[0];
  if (!file) return;
  if (file.size > 52428800) { toast('File must be under 50MB', 'error'); return; }
  _rcvrFwFile = file;
  document.getElementById('rcvr-fw-label').textContent = file.name + ' (' + fmtFileSize(file.size) + ')';
  document.getElementById('rcvr-fw-zone').classList.add('has-file');
}

async function submitFirmware() {
  if (!_rcvrFwFile) { toast('Please select a firmware file', 'error'); return; }
  var version = document.getElementById('rcvr-fw-version').value.trim();
  if (!version) { toast('Version is required', 'error'); return; }
  var btn = document.getElementById('rcvr-fw-submit-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Uploading...';
  try {
    var fn  = 'fw-' + _currentRcvrId + '-' + Date.now() + '-' + _rcvrFwFile.name;
    var up  = await sb.storage.from('programming-files').upload(fn, _rcvrFwFile, {contentType:'application/octet-stream', upsert:false});
    if (up.error) { toast('Upload failed: ' + up.error.message, 'error'); return; }
    var url = sb.storage.from('programming-files').getPublicUrl(fn).data.publicUrl;
    var isLatest = document.getElementById('rcvr-fw-latest').checked;
    // If marking as latest, unmark others
    if (isLatest) {
      await sb.from('rc_receiver_card_firmware').update({is_latest:false}).eq('receiver_card_id', _currentRcvrId);
    }
    var res = await sb.from('rc_receiver_card_firmware').insert({
      receiver_card_id: _currentRcvrId,
      version:          version,
      description:      document.getElementById('rcvr-fw-desc').value.trim() || null,
      is_latest:        isLatest,
      file_name:        fn,
      file_url:         url,
      file_size:        _rcvrFwFile.size,
      uploaded_by:      CU.id
    });
    if (res.error) { toast('Error: ' + res.error.message, 'error'); return; }
    document.getElementById('rcvr-fw-upload-form').style.display = 'none';
    _rcvrFwFile = null;
    await renderFirmwareList(_currentRcvrId);
    toast('Firmware uploaded!', 'success');
  } finally {
    btn.disabled = false; btn.textContent = 'Upload Firmware';
  }
}

async function deleteFirmware(id, fileName) {
  if (!confirm('Delete this firmware version?')) return;
  if (fileName) await sb.storage.from('programming-files').remove([fileName]);
  var res = await sb.from('rc_receiver_card_firmware').delete().eq('id', id);
  if (res.error) { toast('Error: ' + res.error.message, 'error'); return; }
  await renderFirmwareList(_currentRcvrId);
  toast('Firmware deleted', 'info');
}

//    Programming modal open/edit                                            




function resetProgFileZone(type) {
  var zone = document.getElementById('prog-rcfgx-zone');
  var lbl  = document.getElementById('prog-rcfgx-label');
  if (zone) zone.classList.remove('has-file');
  if (lbl)  lbl.textContent = 'Click to upload .rcfgx file';
}

function progFileSelected(event, type) {
  var file = event.target.files[0];
  if (!file) return;
  if (file.size > 52428800) { toast('File must be under 50MB', 'error'); return; }
  _progRcfgxFile = file;
  document.getElementById('prog-rcfgx-label').textContent = file.name + ' (' + fmtFileSize(file.size) + ')';
  document.getElementById('prog-rcfgx-zone').classList.add('has-file');
  document.getElementById('prog-rcfgx-existing').style.display = 'none';
}

function clearProgFile(type) {
  _progRcfgxFile = null; _progRcfgxKeep = false;
  resetProgFileZone('rcfgx');
  document.getElementById('prog-rcfgx-existing').style.display = 'none';
}

async function buildTechCheckboxes(selectedIds) {
  var techs = allUsers.filter(function(u){ return !u.is_admin && !u.is_senior && u.status==='active'; });
  var cont  = document.getElementById('prog-tech-checkboxes');
  if (!cont) return;
  if (!techs.length) { cont.innerHTML = '<div style="font-size:12px;color:var(--tm)">No technicians to assign visibility to.</div>'; return; }
  cont.innerHTML = techs.map(function(u) {
    var chk = selectedIds && selectedIds.indexOf(u.id) >= 0 ? 'checked' : '';
    return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:6px 8px;background:var(--bgc);border:1px solid var(--bdr);border-radius:6px">' +
      '<input type="checkbox" value="' + u.id + '" ' + chk + ' style="accent-color:var(--c1)">' +
      '<span>' + u.name + '</span><span style="font-size:10px;color:var(--tm)">' + u.role + '</span></label>';
  }).join('');
}

//    Submit programming record                                              


async function deleteProgramming(id) {
  if (!confirm('Delete this batch record?')) return;
  var p = allProgramming.find(function(x){ return x.id === id; });
  if (p && p.rcfgx_name) await sb.storage.from('programming-files').remove([p.rcfgx_name]);
  await sb.from('rc_programming_visibility').delete().eq('programming_id', id);
  var res = await sb.from('rc_programming').delete().eq('id', id);
  if (res.error) { toast('Error: ' + res.error.message, 'error'); return; }
  toast('Record deleted', 'info');
  await renderProgrammingPage();
}

// ==============================================
//  PERMISSIONS
// ==============================================
async function loadPermissions() {
  var res = await sb.from('rc_permissions').select('*');
  allPermissions = res.data || [];
}

function openPermissions() {
  var sel = document.getElementById('perm-user-select');
  sel.innerHTML = '<option value="">Select a user...</option>' +
    allUsers.filter(function(u){ return u.status==='active'; }).map(function(u){
      var tag = u.is_admin ? ' [Admin]' : u.is_senior ? ' [Senior]' : '';
      return '<option value="' + u.id + '">' + u.name + tag + '</option>';
    }).join('');
  document.getElementById('perm-body').style.display = 'none';
  document.getElementById('perm-empty').style.display = '';
  document.getElementById('perm-footer').style.display = 'none';
  om('m-permissions');
}

var PERM_DEFS = {
  access: [
    {key:'can_view_programming', label:'View Programming',  sub:'Access programming records'},
    {key:'can_view_stock',       label:'View Stock',        sub:'Access stock control page'},
    {key:'can_view_damage_log',  label:'View Damage Log',   sub:'Access damage log page'},
    {key:'can_view_reports',     label:'View Reports',      sub:'Access reports & PDF export'},
    {key:'can_view_all_jobs',    label:'View All Jobs',     sub:'See jobs not assigned to them'},
  ],
  programming: [
    {key:'can_upload_programming_files',   label:'Upload Files',          sub:'Upload RCFGX and firmware files'},
    {key:'can_add_programming_records',    label:'Add Batch Records',     sub:'Create new batch / receiver card records'},
    {key:'can_edit_programming_records',   label:'Edit Records',          sub:'Modify existing batch and receiver card records'},
    {key:'can_delete_programming_records', label:'Delete Records',        sub:'Remove batch records, receiver cards and firmware'},
  ],
  actions: [
    {key:'can_start_sessions',  label:'Start Work Sessions', sub:'Log time on jobs'},
    {key:'can_log_damage',      label:'Log Damage',          sub:'Create damage entries'},
    {key:'can_edit_damage',     label:'Edit Damage Logs',    sub:'Modify existing damage entries'},
    {key:'can_dispatch_stock',  label:'Dispatch Stock',      sub:'Create stock dispatches'},
    {key:'can_export_pdf',      label:'Export PDF Reports',  sub:'Download PDF reports'},
  ],
  data: [
    {key:'can_view_other_sessions', label:"View Others' Sessions", sub:'See active sessions of other users'},
    {key:'can_view_client_info',    label:'View Client Info',      sub:'See client names on jobs'},
  ]
};

async function loadPermissionsForUser() {
  var uid = document.getElementById('perm-user-select').value;
  if (!uid) {
    document.getElementById('perm-body').style.display = 'none';
    document.getElementById('perm-empty').style.display = '';
    document.getElementById('perm-footer').style.display = 'none';
    return;
  }
  var perm = allPermissions.find(function(p){ return p.user_id === uid; });
  var vals = perm || {
    can_view_programming:true, can_view_stock:true, can_view_damage_log:true,
    can_view_reports:false, can_view_all_jobs:true,
    can_upload_programming_files:true, can_add_programming_records:false,
    can_edit_programming_records:false, can_delete_programming_records:false,
    can_start_sessions:true, can_log_damage:true, can_edit_damage:true,
    can_dispatch_stock:false, can_export_pdf:false,
    can_view_other_sessions:false, can_view_client_info:true
  };
  function buildGrid(defs, containerId) {
    document.getElementById(containerId).innerHTML = defs.map(function(d) {
      return '<div class="perm-row">' +
        '<div><div class="perm-label">' + d.label + '</div><div class="perm-sub">' + d.sub + '</div></div>' +
        '<label class="toggle-sw"><input type="checkbox" data-perm="' + d.key + '" ' + (vals[d.key] ? 'checked' : '') + '>' +
        '<span class="slider"></span></label>' +
      '</div>';
    }).join('');
  }
  buildGrid(PERM_DEFS.access,       'perm-grid-access');
  buildGrid(PERM_DEFS.programming,  'perm-grid-programming');
  buildGrid(PERM_DEFS.actions,      'perm-grid-actions');
  buildGrid(PERM_DEFS.data,         'perm-grid-data');
  document.getElementById('perm-body').style.display  = '';
  document.getElementById('perm-empty').style.display = 'none';
  document.getElementById('perm-footer').style.display = '';
}

async function savePermissions() {
  var uid = document.getElementById('perm-user-select').value;
  if (!uid) return;
  var payload = {user_id: uid, set_by: CU.id, updated_at: new Date().toISOString()};
  document.querySelectorAll('[data-perm]').forEach(function(el) {
    payload[el.getAttribute('data-perm')] = el.checked;
  });
  var existing = allPermissions.find(function(p){ return p.user_id === uid; });
  var res = existing
    ? await sb.from('rc_permissions').update(payload).eq('user_id', uid)
    : await sb.from('rc_permissions').insert(payload);
  if (res.error) { toast('Error: ' + res.error.message, 'error'); return; }
  await loadPermissions();
  toast('Permissions saved!', 'success');
  cm('m-permissions');
}

function userCan(key) {
  if (!CU) return false;
  if (CU.is_admin || CU.is_senior) return true;
  var perm = allPermissions.find(function(p){ return p.user_id === CU.id; });
  if (!perm) return true;
  return perm[key] !== false;
}

// -- Hook into setupUI
var _origSetupUIProg = setupUI;
setupUI = async function() {
  await _origSetupUIProg.call(this);
  await loadProgramming();
  await loadReceiverCards();
  await loadPermissions();
};

// -- Hook into showPage
var _origShowPageProg = showPage;
showPage = function(n) {
  _origShowPageProg(n);
  if (n === 'programming') renderProgrammingPage();
};

