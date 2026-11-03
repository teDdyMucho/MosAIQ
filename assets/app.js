
const $=(q,ctx=document)=>ctx.querySelector(q), $$=(q,ctx=document)=>[...ctx.querySelectorAll(q)];
// Site root, from where this script was loaded (…/assets/app.js), so a link
// built here is right from any page depth.
const SITE_ROOT=(()=>{try{return new URL('../',document.currentScript.src).href}catch(e){return location.origin+'/'}})();
// Public pages: the full-screen menu behind the ☰ button, which only shows on
// narrow screens (assets/site-common.css). Behaves as a modal dialog: focus
// moves in and stays in, Escape closes it, and focus returns to the button.
function navInit(){
 const btn=$('#menuOpen'), menu=$('#siteMenu'); if(!btn||!menu)return;
 const closeBtn=menu.querySelector('.siteMenu-close');
 const onKey=e=>{
  if(e.key==='Escape'){e.preventDefault();close();return}
  if(e.key!=='Tab')return;
  const f=$$('a[href],button',menu); if(!f.length)return;
  const first=f[0], last=f[f.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
 };
 const open=()=>{
  menu.hidden=false; menu.classList.add('isOpen');
  document.documentElement.classList.add('menuOpen');
  btn.setAttribute('aria-expanded','true');
  document.addEventListener('keydown',onKey,true);
  closeBtn?.focus();
 };
 const close=(restoreFocus=true)=>{
  if(menu.hidden)return;
  menu.hidden=true; menu.classList.remove('isOpen');
  document.documentElement.classList.remove('menuOpen');
  btn.setAttribute('aria-expanded','false');
  document.removeEventListener('keydown',onKey,true);
  if(restoreFocus)try{btn.focus()}catch(e){}
 };
 btn.addEventListener('click',open);
 closeBtn?.addEventListener('click',()=>close());
 // Following a link closes the menu, so Back does not land on it still open.
 $$('a',menu).forEach(a=>a.addEventListener('click',()=>close(false)));
 // Widening past the breakpoint hides the ☰ button; do not leave the sheet up.
 if(window.matchMedia){
  const mq=matchMedia('(max-width:900px)');
  const wide=()=>{ if(!mq.matches)close(false); };
  if(mq.addEventListener)mq.addEventListener('change',wide); else if(mq.addListener)mq.addListener(wide);
 }
 window.addEventListener('pageshow',e=>{ if(e.persisted)close(false); });
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

 // "Ask RavAI" rather than "Go to app": it names what the member gets, not
 // where the link goes.
 const label=(u.firstName&&u.firstName!=='Member')?('Ask RavAI · '+u.firstName):'Ask RavAI';
 const converted=[];
 $$('a').forEach(a=>{
  // Compare resolved paths, not raw hrefs: Netlify's pretty URLs serve these
  // pages with login.html rewritten to /login, which a match on the literal
  // 'login.html' never caught, so the live site kept showing "Log in".
  let path=''; try{path=new URL(a.getAttribute('href')||'',location.href).pathname.replace(/\.html$/,'')}catch(e){}
  const text=(a.textContent||'').trim().toLowerCase();
  const isAuthLink=/\/(login|signup)$/.test(path)||/\/trial\/free-trial$/.test(path);
  if(!isAuthLink)return;
  // Leave links that merely point at the app (e.g. "RavMizAI") alone unless
  // they are the sign-in / sign-up calls to action.
  if(!/log ?in|sign ?(up|in)|try free|7-day trial|try ravmizai/.test(text))return;
  a.setAttribute('href',new URL('app/home.html',SITE_ROOT).href);
  a.textContent=/try free|7-day trial|try ravmizai/.test(text)?label:'Ask RavAI';
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

 // Links that lead somewhere else for a signed-in member (the menu's
 // Membership goes to billing instead of the trial signup).
 $$('a[data-auth-href]').forEach(a=>a.setAttribute('href',a.dataset.authHref));
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
// "Remember me" was a checkbox with no name and no handler, so nothing was
// ever remembered. It now fills the email back in on the next visit.
//
// Only the email: the password belongs in the browser's own password manager
// (the "password for ravmizaii.netlify.app" prompt), which stores it in the
// OS keychain. Keeping a password in localStorage would put it in plain text
// on the device, readable by anything running on the page.
const REMEMBER_KEY='rm_remember_email';

function restoreRememberedEmail(f){
 const box=$('#rememberMe'); const input=f.querySelector('[name=email]');
 if(!box||!input)return;
 let saved=null; try{saved=localStorage.getItem(REMEMBER_KEY)}catch(e){}
 if(saved){
  input.value=saved;
  box.checked=true;
  // Send focus to the password, since the email is already filled.
  const pw=f.querySelector('[name=password]');
  if(pw)setTimeout(()=>{try{pw.focus()}catch(e){}},50);
 }else{
  // Unticking it should forget immediately, not at the next sign-in.
  box.checked=box.checked;
 }
 box.addEventListener('change',()=>{
  if(!box.checked){try{localStorage.removeItem(REMEMBER_KEY)}catch(e){}}
 });
}

function rememberEmail(f,email){
 const box=$('#rememberMe');
 try{
  if(box&&box.checked&&email)localStorage.setItem(REMEMBER_KEY,email);
  else localStorage.removeItem(REMEMBER_KEY);
 }catch(e){}
}

function setupLogin(){
 const f=$('#loginForm'); if(!f)return;
 // Sent back here from a failed Google sign-in (see appInit).
 let pending=null; try{pending=sessionStorage.getItem('rm_login_error');sessionStorage.removeItem('rm_login_error')}catch(e){}
 if(pending)showErr(pending);
 restoreRememberedEmail(f);
 f.addEventListener('submit',async e=>{
  e.preventDefault();clearMsg();
  const d=Object.fromEntries(new FormData(f));
  const email=String(d.email||'').trim();
  if(!email||!d.password)return showErr('Enter your email and password.');
  rememberEmail(f,email);
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
// "Continue with Google" on the login and signup pages. Supabase sends the
// visitor to Google and back to the app, where auth.js picks the session up.
function setupGoogle(){
 $$('[data-google]').forEach(btn=>{
  const label=btn.querySelector('span'), text=label?.textContent;
  const reset=()=>{ btn.disabled=false; btn.removeAttribute('aria-busy'); if(label)label.textContent=text; };
  btn.addEventListener('click',async()=>{
   clearMsg();
   btn.disabled=true; btn.setAttribute('aria-busy','true'); if(label)label.textContent='Opening Google…';
   // From the signup page a new member goes on to checkout once Google sends
   // them back, as an email signup does. Remembered across the round trip.
   try{ if(btn.dataset.google==='signup')localStorage.setItem('rm_oauth_intent','signup'); else localStorage.removeItem('rm_oauth_intent'); }catch(e){}
   try{
    await RMAuth.signInWithGoogle({next:'app/home.html'});
    // Leaving for Google; the button stays busy until the page unloads.
   }catch(err){
    try{localStorage.removeItem('rm_oauth_intent')}catch(e){}
    showErr(RMAuth.friendly(err));
    reset();
   }
  });
  // Back from Google through the back/forward cache: no longer busy.
  window.addEventListener('pageshow',e=>{ if(e.persisted)reset(); });
 });
}

// Supabase reports a failed OAuth round trip in the URL (the fragment for the
// implicit flow, the query string for PKCE) instead of creating a session.
function oauthError(){
 const p=new URLSearchParams(location.hash.slice(1)+'&'+location.search.slice(1));
 const code=p.get('error'); if(!code)return '';
 if(code==='access_denied')return 'Google sign-in was cancelled.';
 return 'Google sign-in failed: '+(p.get('error_description')||code);
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
 if(!u){
  // Back from Google with an error instead of a session: carry the reason to
  // the login page rather than dropping it.
  const why=oauthError(); if(why)try{sessionStorage.setItem('rm_login_error',why)}catch(e){}
  location.href='../login.html';return
 }
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

 // Just signed up with Google from the signup page: go on to checkout, as an
 // email signup does. One-shot, so a later visit to home is not redirected.
 let intent=null; try{intent=localStorage.getItem('rm_oauth_intent');localStorage.removeItem('rm_oauth_intent')}catch(e){}
 if(intent==='signup'&&!subscribed){
  try{ const url=await RMAuth.startCheckout(); if(url){location.href=url;return} }
  catch(err){
   try{sessionStorage.setItem('rm_checkout_error',RMAuth.friendly(err))}catch(e){}
   location.href='subscribe.html';return
  }
 }

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
 await setupBalances();
 await setupActivity();
 await setupWalletMembership(subscribed);
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
// Real balances on the home and wallet pages. These were hardcoded ("0
// completed / 21 available", "240 chats") and showed the same numbers to every
// member regardless of what they actually had left.
// Seconds as a human duration. Keeps the seconds visible below an hour, so a
// short call is not rounded out of sight: "45s", "4m 20s", "1h 10m".
function fmtDuration(totalSeconds){
 const s=Math.max(0,Math.floor(Number(totalSeconds)||0));
 if(s<60)return s+'s';
 const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), rem=s%60;
 if(h)return h+'h'+(m?' '+m+'m':'');
 return m+'m'+(rem?' '+rem+'s':'');
}

async function setupBalances(){
 const slots=['#homeMinutes','#homeChats','#walletMinutes','#walletChats'].filter(s=>$(s));
 if(!slots.length)return;

 const w=await RMAuth.wallet();
 // A failed read must not read as "you have nothing left".
 if(!w){
  ['#homeMinutes','#homeChats','#walletMinutes','#walletChats'].forEach(s=>{const e=$(s);if(e)e.textContent='—';});
  const note='Balance unavailable right now. Please refresh.';
  ['#homeBalanceNote','#walletNote'].forEach(s=>{const e=$(s);if(e)e.textContent=note;});
  return;
 }

 // Seconds are the source of truth; minutes are derived and kept only for
 // anything still reading the old column.
 const secs=Number(w.seconds_balance ?? (Number(w.minutes_balance)||0)*60)||0;
 const chats=Number(w.chats_balance)||0;

 const set=(sel,val)=>{const e=$(sel);if(e)e.textContent=val;};
 set('#homeMinutes',fmtDuration(secs));
 set('#homeChats',String(chats));
 set('#walletMinutes',fmtDuration(secs));
 set('#walletChats',String(chats));

 const empty=secs===0&&chats===0;
 const note=empty
  ? 'No balance yet. Voice time and messages are added when your membership starts.'
  : 'Updated '+(w.updated_at?new Date(w.updated_at).toLocaleDateString():'just now')+'.';
 set('#homeBalanceNote',note);
 if($('#walletNote'))$('#walletNote').textContent=
   empty?note:'Voice time and text chats are independent balances.';
}

// Membership block on the wallet page. It read "Member · Active" for everyone,
// including lapsed accounts — the same contradiction the billing page had.
async function setupWalletMembership(subscribed){
 const label=$('#walletMemberLabel'); if(!label)return;
 const chip=$('#walletMemberChip'), note=$('#walletMemberNote');
 const p=await RMAuth.profile();
 const until=p?.subscribed_until?new Date(p.subscribed_until):null;

 label.textContent=subscribed?'Member':'Not a member';
 if(chip){
  chip.textContent=subscribed?'Active':'Inactive';
  chip.style.display='';
  chip.style.color=subscribed?'':'#B4232A';
  chip.style.borderColor=subscribed?'':'#E7B9BC';
 }
 if(note){
  note.textContent=subscribed
   ? (until?'Renews '+until.toLocaleDateString()+'.':'Active with no expiry set.')
   : 'Start a membership to use voice calls and text conversations.';
 }
}

// Recent activity on the wallet page, from wallet_ledger. These rows were
// hardcoded ("-4m 10s", "+1h"), so they showed movements to a member whose
// balance was zero — the list and the balance contradicted each other.
async function setupActivity(){
 const box=$('#walletActivity'); if(!box)return;

 const rows=await RMAuth.ledger(6);
 if(rows===null){
  box.innerHTML='<p class="appSub">Activity unavailable right now. Please refresh.</p>';
  return;
 }
 if(!rows.length){
  box.innerHTML='<p class="appSub">No activity yet. Grants and usage will appear here.</p>';
  return;
 }

 // 'debit' spends; everything else adds. The ledger stores magnitudes, so the
 // sign comes from the kind, not from the stored number.
 const neg=k=>k==='debit';
 const fmt=r=>{
  const parts=[];
  // Prefer seconds; fall back to the legacy minutes column on older rows.
  const secs=Number(r.seconds)||((Number(r.minutes)||0)*60);
  if(secs)parts.push(fmtDuration(secs));
  if(r.chats)parts.push(r.chats+(r.chats===1?' chat':' chats'));
  if(!parts.length)return '—';
  return (neg(r.kind)?'-':'+')+parts.join(' · ');
 };
 const when=t=>{
  const d=new Date(t); if(isNaN(d))return '';
  const mins=(Date.now()-d)/60000;
  if(mins<2)return 'Just now';
  if(mins<60)return Math.round(mins)+'m ago';
  if(mins<1440)return Math.round(mins/60)+'h ago';
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
 };

 box.innerHTML='';
 for(const r of rows){
  const row=document.createElement('div');
  row.className='activityRow';
  const left=document.createElement('div');
  const b=document.createElement('b');
  // textContent, never innerHTML: description is stored data.
  b.textContent=r.description||r.kind;
  const s=document.createElement('small');
  s.textContent=when(r.created_at);
  left.append(b,s);
  const amt=document.createElement('span');
  amt.className=neg(r.kind)?'red':'green';
  amt.textContent=fmt(r);
  row.append(left,amt);
  box.appendChild(row);
 }
}

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
 setupForgot();setupReset();setupLogin();setupGoogle();setupSignup('#signupForm');setupVerify();setupTrial();setupPayment();appInit();publicNavInit();
});
