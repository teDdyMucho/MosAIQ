
const $=(q,ctx=document)=>ctx.querySelector(q), $$=(q,ctx=document)=>[...ctx.querySelectorAll(q)];
function navInit(){
 const t=$('#mobileToggle'), n=$('#navLinks'); if(t&&n)t.onclick=()=>n.classList.toggle('open');
 $$('#navLinks a').forEach(a=>a.addEventListener('click',()=>n?.classList.remove('open')));
}
// Public pages ship with "Log in" / "Try free" in the header. For a visitor who
// is already signed in that reads as being logged out, so swap those links for
// a way back into the app. Runs on the marketing pages only; the member pages
// have their own nav.
async function publicNavInit(){
 if(document.body.classList.contains('appBody'))return;
 if(typeof RMAuth==='undefined')return;
 const u=await RMAuth.currentUser();
 if(!u)return;

 // lets-chat.html is the public gate for text conversation. A member who
 // already pays for it should not be asked to start a trial again — Call and
 // Text are one membership — so send them straight into the conversation.
 if(/lets-chat/.test(location.pathname)&&await RMAuth.isSubscribed()){
  location.href='app/chat.html';
  return;
 }

 const label=(u.firstName&&u.firstName!=='Member')?('Go to app · '+u.firstName):'Go to app';
 const converted=[];
 $$('a').forEach(a=>{
  const href=(a.getAttribute('href')||'').replace(/^\.\//,'');
  const text=(a.textContent||'').trim().toLowerCase();
  const isAuthLink=href==='login.html'||href==='signup.html'||href.startsWith('trial/free-trial');
  if(!isAuthLink)return;
  // Leave links that merely point at the app (e.g. "RavMizAI") alone unless
  // they are the sign-in / sign-up calls to action.
  if(!/log ?in|sign ?up|try free|7-day trial|try ravmizai/.test(text))return;
  a.setAttribute('href','app/home.html');
  a.textContent=/try free|7-day trial|try ravmizai/.test(text)?label:'Go to app';
  converted.push(a);
 });

 // "Log in" and "Try free" sit side by side in the header; once both say the
 // same thing, one of them is noise. Keep the primary and drop its neighbour.
 converted.forEach(a=>{
  if(!a.classList.contains('btn'))return;
  const sib=a.nextElementSibling;
  if(sib&&converted.includes(sib)&&sib.classList.contains('btn')&&a.parentElement===sib.parentElement){
   // a is the outline "Log in", sib is the primary CTA — remove the duplicate.
   a.remove();
  }
 });
}
// Confirmation dialog. Resolves true when confirmed, false otherwise.
// Built here rather than in the page markup so every page gets it without
// repeating the same block seven times.
function confirmModal({title,message,confirmText='Confirm',cancelText='Cancel',danger=false}){
 return new Promise(resolve=>{
  const back=document.createElement('div');
  back.className='modalBackdrop';
  back.setAttribute('role','dialog');
  back.setAttribute('aria-modal','true');
  back.setAttribute('aria-labelledby','modalTitle');
  back.innerHTML=
   '<div class="modalCard">'+
    '<h2 id="modalTitle"></h2><p></p>'+
    '<div class="modalActions">'+
     '<button type="button" class="btn btn-outline" data-act="cancel"></button>'+
     '<button type="button" class="btn '+(danger?'btn-danger':'btn-primary')+'" data-act="ok"></button>'+
    '</div>'+
   '</div>';
  // Set text via textContent so a name or email can never inject markup.
  back.querySelector('h2').textContent=title;
  back.querySelector('p').textContent=message;
  back.querySelector('[data-act=cancel]').textContent=cancelText;
  back.querySelector('[data-act=ok]').textContent=confirmText;

  const prev=document.activeElement;
  let done=false;
  const close=val=>{
   if(done)return; done=true;
   document.removeEventListener('keydown',onKey,true);
   back.remove();
   document.body.style.overflow='';
   try{prev&&prev.focus()}catch(e){}
   resolve(val);
  };
  const onKey=e=>{
   if(e.key==='Escape'){e.preventDefault();close(false);return}
   if(e.key!=='Tab')return;
   // Keep focus inside the dialog.
   const f=[...back.querySelectorAll('button')];
   if(!f.length)return;
   const first=f[0], last=f[f.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  };

  back.querySelector('[data-act=ok]').onclick=()=>close(true);
  back.querySelector('[data-act=cancel]').onclick=()=>close(false);
  back.onclick=e=>{ if(e.target===back)close(false); };   // click outside
  document.addEventListener('keydown',onKey,true);

  document.body.style.overflow='hidden';
  document.body.appendChild(back);
  requestAnimationFrame(()=>{
   back.classList.add('open');
   back.querySelector('[data-act=cancel]').focus();  // safer default
  });
 });
}
// Show/hide for password fields. The input keeps focus and the caret stays put,
// so toggling mid-typing does not interrupt anyone.
function setupPasswordToggles(){
 $$('.pwToggle').forEach(btn=>{
  const input=btn.parentElement?.querySelector('input'); if(!input)return;
  btn.onclick=()=>{
   const shown=input.type==='text';
   const pos=input.selectionStart;
   input.type=shown?'password':'text';
   btn.setAttribute('aria-pressed',String(!shown));
   btn.setAttribute('aria-label',shown?'Show password':'Hide password');
   try{ input.focus(); input.setSelectionRange(pos,pos); }catch(e){}
  };
 });
}
function showErr(msg,el='#formError'){const e=$(el);if(e){e.textContent=msg;e.style.display='block';}}
function showOk(msg,el='#formSuccess'){const e=$(el);if(e){e.textContent=msg;e.style.display='block';}}
function clearMsg(){['#formError','#formSuccess'].forEach(s=>{const e=$(s);if(e)e.style.display='none';});}
function storeUser(u){localStorage.setItem('rm_user',JSON.stringify(u))}
function getUser(){try{return JSON.parse(localStorage.getItem('rm_user')||'null')}catch(e){return null}}

function emailFromUser(){const u=getUser();return u?.email||'member@ravmizai.com'}

function setupSignup(formId, next='verify.html'){
 const f=$(formId); if(!f)return;
 f.addEventListener('submit',async e=>{
  e.preventDefault(); clearMsg();
  const d=Object.fromEntries(new FormData(f));
  const first=String(d.first||'').trim(), last=String(d.last||'').trim(), email=String(d.email||'').trim();
  if(!first||!last||!email||!d.password)return showErr('Please complete all required fields.');
  const pwIssue=RMAuth.passwordProblem(d.password);
  if(pwIssue)return showErr(pwIssue);
  // Only enforced when the form actually has a confirm field.
  if(f.querySelector('[name=password2]')&&d.password!==d.password2)
   return showErr('Passwords do not match.');
  if(!f.querySelector('[name=agree]')?.checked)return showErr('Please agree to the Terms of Service and Privacy Policy.');
  localStorage.setItem('rm_next_after_verify',d.next||'app/home.html');
  busy(f,true,'Creating account…');
  try{
   const {needsVerification}=await RMAuth.signUp({first,last,email,password:d.password});
   if(needsVerification){location.href=next;return}
   await RMAuth.syncLegacyUser();
   // A card is required to sign up, so go straight to Stripe rather than
   // dropping the new member on a page they cannot use yet. The trial starts
   // at checkout and the first charge follows 7 days later.
   await goToCheckout(f,d.next||'app/home.html');
  }catch(err){
   showErr(RMAuth.friendly(err));
   busy(f,false);
  }
 });
}

// Sends a just-registered user into Stripe Checkout. If checkout cannot be
// started, fall back to `fallback` with an explanation instead of stranding
// them -- the account exists either way, and the gate still protects access.
async function goToCheckout(form,fallback){
 try{
  busy(form,true,'Opening secure checkout…');
  const url=await RMAuth.startCheckout();
  location.href=url||fallback;
 }catch(err){
  console.warn('[RavMizAI] checkout after signup failed:',err?.message);
  sessionStorage.setItem('rm_checkout_error',RMAuth.friendly(err));
  location.href=fallback;
 }
}
// Disables a form's submit button while a request is in flight, so a slow
// network can't produce duplicate signups or login attempts.
function busy(form,on,label){
 // Exclude .pwToggle: it is a type="button" inside the form and would
 // otherwise be picked up as the submit control.
 const b=form.querySelector('button[type=submit],button:not([type]):not(.pwToggle)');
 if(!b)return;
 if(on){b.dataset.label??=b.textContent;b.disabled=true;b.style.opacity='.6';b.style.cursor='wait';if(label)b.textContent=label;}
 else{b.disabled=false;b.style.opacity='';b.style.cursor='';if(b.dataset.label)b.textContent=b.dataset.label;}
}
function setupLogin(){
 const f=$('#loginForm'); if(!f)return;
 f.addEventListener('submit',async e=>{
  e.preventDefault();clearMsg();
  const d=Object.fromEntries(new FormData(f));
  const email=String(d.email||'').trim();
  if(!email||!d.password)return showErr('Enter your email and password.');
  busy(f,true,'Signing in…');
  try{
   const {needsVerification}=await RMAuth.signIn({email,password:d.password});
   if(needsVerification){localStorage.setItem('rm_verify_email',email);location.href='verify.html';return}
   await RMAuth.syncLegacyUser();
   location.href='app/home.html';
  }catch(err){
   showErr(RMAuth.friendly(err));
   busy(f,false);
  }
 });
}
// "Forgot password" — request the reset email.
function setupForgot(){
 const f=$('#forgotForm'); if(!f)return;
 f.addEventListener('submit',async e=>{
  e.preventDefault();clearMsg();
  const email=String(new FormData(f).get('email')||'').trim();
  if(!email)return showErr('Enter your email address.');
  busy(f,true,'Sending…');
  try{
   await RMAuth.requestPasswordReset(email);
   // Deliberately the same message whether or not the address is registered,
   // so this page cannot be used to find out who has an account.
   showOk('If an account exists for '+email+', a reset link is on its way. Check your inbox and spam folder.');
   f.reset();
  }catch(err){ showErr(RMAuth.friendly(err)); }
  busy(f,false);
 });
}

// "Set a new password" — reached from the emailed link.
function setupReset(){
 const f=$('#resetForm'); if(!f)return;
 // Supabase puts the recovery token in the URL fragment and exchanges it for a
 // session. That is asynchronous, so check a moment later rather than at once.
 if(RMAuth.isLive){
  setTimeout(async()=>{
   const u=await RMAuth.currentUser();
   const note=$('#resetFor');
   if(u&&note)note.textContent='Setting a new password for '+u.email+'.';
   else if(!u)showErr('This reset link is invalid or has expired. Request a new one from the sign-in page.');
  },1200);
 }
 f.addEventListener('submit',async e=>{
  e.preventDefault();clearMsg();
  const d=Object.fromEntries(new FormData(f));
  const issue=RMAuth.passwordProblem(d.password);
  if(issue)return showErr(issue);
  if(d.password!==d.password2)return showErr('Passwords do not match.');
  busy(f,true,'Saving…');
  try{
   await RMAuth.updatePassword(d.password);
   showOk('Password updated. Redirecting you to sign in…');
   setTimeout(async()=>{ await RMAuth.signOut(); location.href='login.html'; },1600);
  }catch(err){
   showErr(RMAuth.friendly(err));
   busy(f,false);
  }
 });
}

function setupVerify(){
 const f=$('#verifyForm'); if(!f)return;
 const stored=localStorage.getItem('rm_verify_email');
 const addr=stored||getUser()?.email||'your email';
 const email=$('#verifyEmail'); if(email)email.textContent=addr;
 // The fixed-code hint only applies to the offline prototype.
 if(RMAuth.isLive)$$('.protoHint').forEach(el=>el.remove());
 f.addEventListener('submit',async e=>{
  e.preventDefault();clearMsg();
  const code=$('#code').value.trim();
  if(!/^\d{6}$/.test(code))return showErr('Enter the 6-digit code from your email.');
  busy(f,true,'Verifying…');
  try{
   await RMAuth.verify({code,email:stored});
   await RMAuth.syncLegacyUser();
   const next=localStorage.getItem('rm_next_after_verify')||'app/home.html';
   // With email confirmation on, this is the first moment the user has a
   // session, so checkout happens here instead of at signup.
   if(await RMAuth.isSubscribed()){location.href=next;return}
   await goToCheckout(f,next);
  }catch(err){
   showErr(RMAuth.friendly(err));
   busy(f,false);
  }
 });
 const r=$('#resendCode');
 if(r)r.onclick=async e=>{
  e.preventDefault();clearMsg();
  try{
   await RMAuth.resend({email:stored});
   showOk(RMAuth.isLive?'A new code is on its way. Check your email.':'A new verification code was sent. For this prototype, use 111111.');
  }catch(err){showErr(RMAuth.friendly(err));}
 };
}
function setupTrial(){
 const f=$('#trialSignup'); if(!f)return;
 // The home page's email box sends visitors here as ?email=…; carry it over.
 const pre=new URLSearchParams(location.search).get('email');
 if(pre&&f.email&&!f.email.value)f.email.value=pre.trim().slice(0,254);
 f.addEventListener('submit',async e=>{
  e.preventDefault();clearMsg();const d=Object.fromEntries(new FormData(f));
  const first=String(d.first||'').trim(), last=String(d.last||'').trim(), email=String(d.email||'').trim();
  if(!first||!last||!email||!d.password)return showErr('Please complete all fields.');
  const pwIssue=RMAuth.passwordProblem(d.password);
  if(pwIssue)return showErr(pwIssue);
  if(f.querySelector('[name=password2]')&&d.password!==d.password2)
   return showErr('Passwords do not match.');
  if(!f.querySelector('[name=agree]')?.checked)return showErr('Please agree to the Terms and Privacy Policy.');
  localStorage.setItem('rm_next_after_verify','payment.html');
  busy(f,true,'Creating account…');
  try{
   const {needsVerification}=await RMAuth.signUp({first,last,email,password:d.password});
   location.href=needsVerification?'verify.html':'payment.html';
  }catch(err){showErr(RMAuth.friendly(err));busy(f,false);}
 });
}
// The trial page no longer collects card details -- it hands off to Stripe
// Checkout, which reports precise errors and keeps card data off this site.
// Guard the page so a signed-out visitor is not left on a dead end.
function setupPayment(){
 if(!$('#startCheckout')||!/trial\//.test(location.pathname))return;
 RMAuth.currentUser().then(cu=>{ if(!cu&&!getUser()?.verified)location.href='free-trial.html'; });
 // The trial page is not an appBody page, so appInit() never runs here and the
 // checkout button has to be wired explicitly.
 setupCheckoutButton();
}
// Pages that require an active membership, not just a login. Compared without
// the extension, since some hosts serve these as clean URLs (/app/chat).
const MEMBER_ONLY=['call-intro','chat'];
function pageName(){
 return (location.pathname.split('/').pop()||'home').replace(/\.html$/,'');
}

async function appInit(){
 if(!document.body.classList.contains('appBody'))return;
 const menu=$('#userMenu'); const btn=$('#userMenuBtn'); if(menu&&btn)btn.onclick=()=>menu.classList.toggle('open');
 // Under live auth the session is restored asynchronously, so check it before
 // deciding the visitor is signed out.
 const u=await RMAuth.currentUser();
 if(!u){location.href='../login.html';return}
 await RMAuth.syncLegacyUser();
 $$('.userName').forEach(e=>e.textContent=u.firstName||'Member');
 $$('.userEmail').forEach(e=>e.textContent=u.email||'member@ravmizai.com');
 // Avatar shows the first name's initial, falling back to the email's.
 const initial=((u.firstName&&u.firstName!=='Member'?u.firstName:u.email)||'U').trim().charAt(0).toUpperCase();
 $$('.userInitial').forEach(e=>e.textContent=initial);
 $$('#userMenuBtn').forEach(btn=>{ if(!btn.querySelector('.userInitial'))btn.textContent=initial; });

 // Sign out. The markup ships as a plain link to index.html, which only
 // changed page while leaving the session intact — so the next member page
 // let the visitor straight back in.
 $$('#signOut').forEach(out=>{
  out.onclick=async e=>{
   e.preventDefault();
   const yes=await confirmModal({
    title:'Sign out?',
    message:'You will need to sign in again to continue your conversation with RavMizAI.',
    confirmText:'Sign out',
    cancelText:'Stay signed in',
    danger:true
   });
   if(!yes)return;
   try{ await RMAuth.signOut(); }
   catch(err){ console.warn('[RavMizAI] sign-out failed:',err?.message); }
   // Clear prototype leftovers too, so nothing claims a session afterwards.
   ['rm_user','rm_verify_code','rm_verify_email','rm_next_after_verify','rm_prefs','rm_activity']
     .forEach(k=>{try{localStorage.removeItem(k)}catch(_){}} );
   location.href='../login.html';
  };
 });

 const page=pageName();
 const subscribed=await RMAuth.isSubscribed();

 // Gate the conversation pages. Landing on one directly must not bypass this.
 if(MEMBER_ONLY.includes(page)&&!subscribed){location.href='subscribe.html';return}

 // Already a member? Nothing to sell — send them to the conversation.
 if(page==='subscribe'&&subscribed){location.href='call-intro.html';return}

 document.body.classList.toggle('isSubscribed',subscribed);
 setupSubscribeGate(subscribed);
 setupCheckoutButton();

 // Checkout could not be opened right after signing up. Say so, rather than
 // leaving the new member wondering why nothing was charged.
 const pending=sessionStorage.getItem('rm_checkout_error');
 if(pending){
  sessionStorage.removeItem('rm_checkout_error');
  if(!subscribed)showErr(pending);
 }

 // Returning from a cancelled Stripe checkout.
 if(new URLSearchParams(location.search).get('checkout')==='cancelled'&&!subscribed){
  showErr('Checkout was cancelled. Your membership has not started yet.');
 }
 await setupBillingStatus(subscribed);
 await setupBillingControls();
}

// Call / Text buttons: send non-members to the subscription page instead of
// into the conversation.
function setupSubscribeGate(subscribed){
 if(subscribed)return;
 // Call and Text are the same membership — one subscription covers both, so
 // they gate identically. lets-chat.html stays listed because older markup
 // pointed Text at that public page.
 const targets=['call-intro.html','chat.html','../lets-chat.html','lets-chat.html'];
 $$('a.btn').forEach(a=>{
  const href=a.getAttribute('href')||'';
  if(!targets.includes(href))return;
  a.setAttribute('href','subscribe.html');
  a.setAttribute('data-gated','1');
 });
}

// Sends the visitor to Stripe Checkout. The button is disabled while the
// session is being created, so a double click cannot open two checkouts.
function setupCheckoutButton(){
 const btn=$('#startCheckout'); if(!btn)return;
 btn.onclick=async()=>{
  clearMsg();
  btn.disabled=true; btn.dataset.label??=btn.textContent;
  btn.textContent='Opening secure checkout…'; btn.style.opacity='.6'; btn.style.cursor='wait';
  try{
   const url=await RMAuth.startCheckout();
   // Live: Stripe's hosted page. Offline: null, trial already granted.
   location.href=url||'home.html';
  }catch(err){
   showErr(RMAuth.friendly(err));
   btn.disabled=false; btn.textContent=btn.dataset.label;
   btn.style.opacity=''; btn.style.cursor='';
  }
 };
}

// billing.html ships with a hardcoded "Membership active". Replace it with the
// real state so the page cannot claim a membership the account does not have.
// Card summary + the buttons that open Stripe's Billing Portal.
async function setupBillingControls(){
 const slot=$('#cardSummary');
 if(slot){
  const p=await RMAuth.profile();
  if(p?.card_last4){
   const brand=(p.card_brand||'card').replace(/^./,c=>c.toUpperCase());
   slot.textContent=brand+' ending in '+p.card_last4;
  }else{
   slot.textContent='No card on file';
  }
 }
 setupBillingButtons();
}
function setupBillingButtons(){
 const open=async()=>{
  clearMsg();
  try{
   const url=await RMAuth.billingPortal();
   location.href=url;
  }catch(err){ showErr(RMAuth.friendly(err)); }
 };
 const btn=$('#manageBilling');
 if(btn)btn.onclick=open;
 const upd=$('#updateCard');
 if(upd)upd.onclick=e=>{e.preventDefault();open();};
}

async function setupBillingStatus(subscribed){
 const head=$('#billingStatus'); if(!head)return;
 const p=await RMAuth.profile();
 const until=p?.subscribed_until?new Date(p.subscribed_until):null;
 head.textContent=subscribed?'Membership active':'No active membership';
 head.style.color=subscribed?'':'#ff8f98';
 const note=$('#billingNote');
 if(note){
  note.textContent=subscribed
   ?(until?'Renews '+until.toLocaleDateString()+'.':'Active with no expiry set.')
   :'Start a membership to use voice calls and text conversations.';
 }
 const cta=$('#billingCta');
 if(cta)cta.style.display=subscribed?'none':'';
}
function setupPrefs(){
 const form=$('#prefsForm'); if(!form)return;
 const saved=JSON.parse(localStorage.getItem('rm_prefs')||'{}');
 $$('[data-group]').forEach(el=>{
  const group=el.dataset.group, val=el.dataset.value;
  if((saved[group]||[]).includes(val))el.classList.add('active');
  el.onclick=()=>{ if(el.classList.contains('single')) $$(`[data-group="${group}"]`).forEach(x=>x.classList.remove('active')); el.classList.toggle('active');};
 });
 if(saved.callme)$('#callme').value=saved.callme;
 form.addEventListener('submit',e=>{
  e.preventDefault();const out={callme:$('#callme').value};
  $$('[data-group].active').forEach(el=>{(out[el.dataset.group]??=[]).push(el.dataset.value)});
  localStorage.setItem('rm_prefs',JSON.stringify(out));showOk('Preferences saved.','#prefSuccess');window.scrollTo({top:0,behavior:'smooth'});
 });
}
// Call controls on chat.html. The call itself is still a prototype, so these
// drive the on-screen state rather than real audio.
function setupCallControls(){
 const mute=$('#btnMute'), pause=$('#btnPause'), text=$('#btnText'), end=$('#btnEnd');
 if(!mute&&!pause&&!text&&!end)return;
 const status=$('#callStatus');
 const setStatus=s=>{ if(status)status.textContent=s; };

 const toggle=(btn,onLabel,offLabel)=>{
  if(!btn)return;
  btn.onclick=()=>{
   const on=btn.getAttribute('aria-pressed')==='true';
   btn.setAttribute('aria-pressed',String(!on));
   btn.setAttribute('aria-label',!on?onLabel:offLabel);
  };
 };
 toggle(mute,'Unmute microphone','Mute microphone');
 toggle(pause,'Resume call','Pause call');

 // Reflect combined state in the status line.
 const sync=()=>{
  if(pause?.getAttribute('aria-pressed')==='true')setStatus('Paused');
  else if(mute?.getAttribute('aria-pressed')==='true')setStatus('Muted');
  else setStatus('Listening…');
 };
 [mute,pause].forEach(b=>b&&b.addEventListener('click',sync));

 if(text)text.onclick=()=>{ const t=$('#transcript'); if(t)t.scrollIntoView({behavior:'smooth',block:'center'}); };

 if(end)end.onclick=async()=>{
  const yes=await confirmModal({
   title:'End this call?',
   message:'Your conversation will close and the remaining time stays on your wallet.',
   confirmText:'End call',
   cancelText:'Keep talking',
   danger:true
  });
  if(yes)location.href='home.html';
 };
}
function setupTranscript(){
 const transcript=$('#transcript'); if(!transcript)return;
 const sample=[
 ['RavMizAI',"Shalom. Good to have you back. What's on your mind today?"],
 ['You',"I wanted to talk about how heavy the world feels right now."],
 ['RavMizAI',"I hear that. When the world feels heavy, it can affect emunah, focus, and your sense of safety. What part is weighing on you most?"],
 ['You',"I feel like I should be doing more."],
 ['RavMizAI',"That desire can be meaningful. Before deciding what action to take, it helps to separate clear responsibility from fear or pressure. What is one concrete area where you already have influence?"]
 ];
 transcript.innerHTML=sample.map(([who,msg])=>`<div class="msg ${who==='You'?'you':''}"><b>${who}</b><div class="bubble">${msg}</div></div>`).join('');
}
document.addEventListener('DOMContentLoaded',()=>{
 navInit();setupPrefs();setupTranscript();setupCallControls();setupPasswordToggles();
 // The auth-aware pages need assets/auth.js. Fail loudly rather than silently
 // leaving a form that looks live but does nothing.
 if(typeof RMAuth==='undefined'){
  if($('#loginForm')||$('#signupForm')||$('#verifyForm')||$('#trialSignup')||document.body.classList.contains('appBody')){
   showErr('Authentication failed to load. Please refresh the page.');
   console.error('[RavMizAI] assets/auth.js did not load — auth pages require it.');
  }
  return;
 }
 setupForgot();setupReset();setupLogin();setupSignup('#signupForm');setupVerify();setupTrial();setupPayment();appInit();publicNavInit();
});
