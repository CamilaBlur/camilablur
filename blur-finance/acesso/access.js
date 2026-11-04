import {totpHints,validTotp} from './mfa-model.mjs';
import {accessView, approvedCsv, PLAY_TEST_URL} from './access-model.mjs';
const endpoint='https://blur-finance-quotes.camilablur.workers.dev/access';
const el=id=>document.getElementById(id);
let sdk, auth, generation=0, verificationUntil=0, automaticChecks=0, chooseGoogleAccount=false;
const state={user:null,status:null,busy:true,error:'',notice:'',rows:[],cursor:null,challenge:null};
function bounded(promise, milliseconds, code='service_unavailable') {
  let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(code)),milliseconds);});
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}
const messages={
  verified_email_required:'A confirmação ainda não apareceu na sessão. Entre novamente com Google ou confirme o e-mail recebido.',
  invalid_session:'Sua sessão precisa ser renovada. Troque de conta e entre novamente.',
  sign_in_required:'Entre com Google para continuar.',
  admin_required:'Esta área está disponível apenas para a responsável pelo app.',
  user_limit:'Aguarde um pouco antes de atualizar novamente.',
  login_timeout:'O login ainda não foi concluído. Se a janela do Google não abriu, tente novamente no Chrome.',
  request_not_found:'Este pedido não está mais disponível. Atualize a lista.',
};
function button(label, action, {primary=false,disabled=state.busy}={}) {
  const b=document.createElement('button');b.textContent=label;b.disabled=disabled;if(primary)b.className='primary';b.addEventListener('click',action);return b;
}
function link(label,href,primary=false) {
  const a=document.createElement('a');a.className='button'+(primary?' primary':'');a.textContent=label;a.href=href;return a;
}
async function api(path,body) {
  const user=auth.currentUser;if(!user)throw Error('sign_in_required');
  const token=await bounded(sdk.getIdToken(user,true),15000);
  if(auth.currentUser?.uid!==user.uid)throw Error('account_changed');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(endpoint+'/'+path,{method:body===undefined?'GET':'POST',cache:'no-store',signal:controller.signal,
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    let data;try{data=await response.json();}catch{throw Error('service_unavailable');}
    if(!response.ok)throw Error(data.error||'service_unavailable');return data;
  } finally {clearTimeout(timer);}
}
function errorText(error) {
  if(messages[error.message])return messages[error.message];
  if(error.code==='auth/popup-closed-by-user'||error.code==='auth/cancelled-popup-request')return 'Login cancelado. Você pode tentar novamente.';
  if(error.code==='auth/popup-blocked')return 'O navegador bloqueou a janela de login. Abra este link no Chrome e permita o login com Google.';
  if(['auth/invalid-verification-code','auth/invalid-totp-code'].includes(error.code))return 'Código inválido ou expirado. Informe o código atual do autenticador.';
  if(['auth/invalid-multi-factor-session','auth/session-expired'].includes(error.code))return 'A confirmação expirou. Cancele e entre novamente.';
  if(error.code==='auth/too-many-requests')return 'Muitos envios em sequência. Aguarde antes de pedir outra confirmação.';
  if(error.code==='auth/unauthorized-domain')return 'Este endereço ainda não foi autorizado para o login. Entre em contato com o suporte.';
  if(error.message==='invalid_email')return 'Há um e-mail inválido na lista. Confira os cadastros antes de exportar.';
  return 'Não foi possível concluir agora. Confira sua conexão e tente novamente.';
}
async function run(action) {
  if(state.busy)return;const epoch=generation;state.busy=true;state.error='';state.notice='';render();
  try{await action();}catch(error){if(epoch===generation&&error.message!=='account_changed')state.error=errorText(error);}
  finally{if(epoch===generation){state.busy=false;render();}}
}
async function refresh() {
  await run(async()=>{
    const user=auth.currentUser;if(!user)return;
    await bounded(sdk.reload(user),15000);
    if(auth.currentUser?.uid!==user.uid)throw Error('account_changed');
    state.user=auth.currentUser;
    if(!state.user.emailVerified){state.status=null;return;}
    const result=await api('status');accessView(state.user,result);state.status=result;
    if(result.admin)await loadRequests(false);
  });
}
async function googleLogin() {
  await run(async()=>{
    const provider=new sdk.GoogleAuthProvider();if(chooseGoogleAccount)provider.setCustomParameters({prompt:'select_account'});
    try { await bounded(sdk.signInWithPopup(auth,provider),90000,'login_timeout'); }
    catch(error) {
      if(error.code!=='auth/multi-factor-auth-required')throw error;
      state.challenge=sdk.getMultiFactorResolver(auth,error);
    }
  });
}
async function confirmSecondFactor(uid,code) {
  if(!validTotp(code)){state.error='Informe os 6 números do autenticador.';render();return;}
  const challenge=state.challenge;
  if(!challenge||!totpHints(challenge.hints).some(h=>h.uid===uid)){state.error='Entre novamente para confirmar o acesso.';render();return;}
  await run(async()=>{
    const assertion=sdk.TotpMultiFactorGenerator.assertionForSignIn(uid,code);
    await bounded(challenge.resolveSignIn(assertion),20000);
    if(state.challenge===challenge)state.challenge=null;
  });
}
function renderSecondFactor(actions) {
  const factors=totpHints(state.challenge.hints);
  if(!factors.length){const note=document.createElement('p');note.textContent='Este método de confirmação precisa ser usado pelo aplicativo. Abra a versão web do Blur.';actions.append(note,link('Abrir Blur','../',true));}
  else {
    let selection;
    if(factors.length>1){selection=document.createElement('select');selection.setAttribute('aria-label','Autenticador');for(const f of factors){const option=document.createElement('option');option.value=f.uid;option.textContent=f.name;selection.append(option);}selection.disabled=state.busy;actions.append(selection);}
    const code=document.createElement('input');code.type='text';code.inputMode='numeric';code.autocomplete='one-time-code';code.maxLength=6;code.setAttribute('aria-label','Código de 6 números');code.placeholder='Código de 6 números';code.disabled=state.busy;
    code.addEventListener('input',()=>{code.value=code.value.replace(/[^0-9]/g,'').slice(0,6);});
    const submit=()=>confirmSecondFactor(selection?selection.value:factors[0].uid,code.value);
    code.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();submit();}});
    actions.append(code,button('Confirmar acesso',submit,{primary:true}));
  }
  actions.append(button('Cancelar confirmação',()=>{state.challenge=null;state.error='';render();}));
}
async function changeAccount() {
  chooseGoogleAccount=true;await run(async()=>{await sdk.signOut(auth);});
}
async function requestAccess() {
  await run(async()=>{state.status=await api('request',{});automaticChecks=0;state.notice='Pedido enviado. Acompanhe a aprovação nesta página.';});
}
async function sendVerification() {
  if(Date.now()<verificationUntil)return;
  await run(async()=>{
    const user=auth.currentUser;await bounded(sdk.reload(user),15000);state.user=auth.currentUser;
    if(state.user.emailVerified){state.status=await api('status');return;}
    await sdk.sendEmailVerification(user);verificationUntil=Date.now()+60000;
    state.notice='Confirmação solicitada. Confira a caixa de entrada e o spam; depois volte e atualize o status.';
    setTimeout(()=>render(),60500);
  });
}
function render() {
  let view=state.challenge?'second_factor':accessView(state.user,state.status);if(!sdk)view='loading';
  const titles={second_factor:'Confirme seu acesso',sign_in:'Seu acesso começa aqui',loading:'Conferindo seu acesso',verify_email:'Confirme sua conta',request:'Solicite seu acesso',pending:'Pedido enviado',denied:'Pedido não aprovado',approved_waiting_play:'Acesso ao Blur aprovado',ready:'Tudo pronto para começar'};
  const copies={second_factor:'Abra seu aplicativo autenticador e informe o código do Blur Finance.',sign_in:'Entre com Google para solicitar acesso ou conferir sua aprovação.',loading:'Aguarde enquanto consultamos sua conta.',verify_email:'Sua conta ainda está sem confirmação. Você pode entrar novamente com Google ou confirmar pelo e-mail.',request:'Envie seu pedido para a CamilaBlur analisar.',pending:'Seu pedido está aguardando a aprovação da CamilaBlur.',denied:'A CamilaBlur não aprovou este pedido. Você pode falar com o suporte.',approved_waiting_play:'Você já pode usar a versão web. A liberação na Google Play ainda está sendo concluída.',ready:'Seu acesso está aprovado. Participe do teste na Google Play para instalar o aplicativo.'};
  el('status-title').textContent=titles[view];el('status-copy').textContent=copies[view];
  el('badge').textContent=state.busy?'Conferindo…':view==='ready'?'Acesso liberado':'Convite para o teste';
  el('identity').hidden=!state.user;el('identity').replaceChildren();
  if(state.user){const name=document.createElement('small');name.textContent=state.user.displayName||'Conta conectada';el('identity').append(name,document.createTextNode(state.user.email||''));}
  const actions=el('actions');actions.replaceChildren();
  if(view==='second_factor')renderSecondFactor(actions);
  if(view==='sign_in')actions.append(button('Entrar com Google',googleLogin,{primary:true}));
  if(view==='request')actions.append(button('Solicitar acesso',requestAccess,{primary:true}));
  if(view==='verify_email'){
    actions.append(button('Entrar novamente com Google',changeAccount,{primary:true}));
    actions.append(button(Date.now()<verificationUntil?'Aguarde para reenviar':'Enviar confirmação de e-mail',sendVerification,{disabled:state.busy||Date.now()<verificationUntil}));
  }
  if(view==='ready'){
    const a=link('Baixar na Google Play',PLAY_TEST_URL,true);a.target='_blank';a.rel='noopener noreferrer';actions.append(a);
  }
  if(view==='ready'||view==='approved_waiting_play')actions.append(link('Abrir versão web','../',view==='approved_waiting_play'));
  if(state.user)actions.append(button('Atualizar status',refresh));
  el('detail').textContent=view==='request'?'Ao solicitar, seu nome e e-mail serão enviados à CamilaBlur para análise.':view==='ready'?'Use '+state.user.email+' no navegador e na Play Store. Na página da Google, toque em Participar do teste e depois em Fazer download no Google Play.':'Use a mesma conta no navegador e na Google Play Store.';
  el('message').textContent=state.error||state.notice;el('message').className=state.error?'error':'notice';
  el('session-actions').replaceChildren();if(state.user){const b=button('Trocar de conta',changeAccount);b.classList.add('inline');el('session-actions').append(b);}
  el('store-help').hidden=view!=='ready';
  el('admin').hidden=!state.status?.admin;
  if(state.status?.admin)renderRows();
  for(const id of ['load-requests','export-csv','more'])el(id).disabled=state.busy;
}
async function loadRequests(more=false) {
  const path='requests'+(more&&state.cursor?'?cursor='+encodeURIComponent(state.cursor):'');
  const page=await api(path);if(!state.status?.admin)return;
  const byId=new Map(more?state.rows.map(row=>[row.uid,row]):[]);
  for(const row of page.requests)byId.set(row.uid,row);
  state.rows=[...byId.values()].sort((a,b)=>String(b.requestedAt||b.invitedAt||'').localeCompare(String(a.requestedAt||a.invitedAt||'')));state.cursor=page.cursor;
}
function renderRows() {
  const container=el('rows');container.replaceChildren();const selected=el('filter').value;
  const rows=state.rows.filter(row=>selected==='all'||row.status===selected);
  if(!rows.length){const p=document.createElement('p');p.className='minor';p.textContent='Nenhum pedido nesta seleção.';container.append(p);}
  for(const row of rows){
    const item=document.createElement('article');item.className='row';
    const who=document.createElement('div');who.className='who';who.textContent=row.email;
    const status=document.createElement('small');status.textContent=row.status==='approved'?(row.playReady?'Aprovado · Google Play liberada':'Aprovado · inclusão na Play pendente'):row.status==='pending'?'Aguardando aprovação':'Não aprovado';who.append(status);
    if(row.source==='admin_invitation'){const source=document.createElement('small');source.textContent='Convite da responsável';who.append(source);}
    const buttons=document.createElement('div');buttons.className='buttons';
    if(row.status!=='approved')buttons.append(button('Aprovar acesso',()=>review(row,'approved'),{primary:true}));
    if(row.status==='approved'&&!row.playReady)buttons.append(button('Confirmar inclusão na Play',()=>review(row,'approved',true),{primary:true}));
    if(row.status!=='denied')buttons.append(button('Recusar',()=>review(row,'denied')));
    item.append(who,buttons);container.append(item);
  }
  el('more').hidden=!state.cursor;
}
async function review(row,status,playReady) {
  const text=playReady===true?'Confirma que '+row.email+' já foi incluído na lista de testadores da Play Console?':status==='approved'?'Aprovar o acesso de '+row.email+' ao Blur?':'Recusar o acesso de '+row.email+'?';
  if(!window.confirm(text))return;
  await run(async()=>{
    const result=await api('review',{uid:row.uid,status,...(playReady===undefined?{}:{playReady})});
    if(result.status!==status)throw Error('service_unavailable');
    state.rows=state.rows.map(value=>value.uid===row.uid?{...value,status,playReady:result.playReady===true}:value);
    state.notice=playReady?'Liberação na Google Play confirmada.':status==='approved'?'Acesso aprovado. Inclua o e-mail na Play Console para liberar o download.':'Pedido recusado.';
  });
}
async function exportCsv() {
  if(!window.confirm('O CSV inclui a responsável e os pedidos aprovados. A importação substitui a lista da Play Console. Confira se todos os participantes atuais estão no arquivo.'))return;
  await run(async()=>{
    const pages=[],seen=new Set();let cursor=null;
    do{const page=await api('requests'+(cursor?'?cursor='+encodeURIComponent(cursor):''));pages.push(page);cursor=page.cursor;if(cursor){if(seen.has(cursor)||seen.size>=100)throw Error('service_unavailable');seen.add(cursor);}}while(cursor);
    const blob=new Blob([approvedCsv(pages)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='Blur-Finance-emails-aprovados.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    state.notice='CSV exportado. Importe na Play Console e depois confirme a inclusão de cada e-mail na loja.';
  });
}
el('copy-play').addEventListener('click',()=>run(async()=>{await navigator.clipboard.writeText(PLAY_TEST_URL);state.notice='Convite copiado. Cole na barra de endereços do Chrome e aceite participar com a mesma conta da Play Store.';}));
el('filter').addEventListener('change',renderRows);
el('load-requests').addEventListener('click',()=>run(()=>loadRequests(false)));
el('more').addEventListener('click',()=>run(()=>loadRequests(true)));
el('export-csv').addEventListener('click',exportCsv);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.user&&!state.busy){automaticChecks=0;void refresh();}});
setInterval(()=>{if(!document.hidden&&state.user&&!state.busy&&automaticChecks<10&&['pending','approved_waiting_play'].includes(accessView(state.user,state.status))){automaticChecks++;void refresh();}},30000);
try{
  const appSdk=await bounded(import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'),20000);
  sdk=await bounded(import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js'),20000);
  const app=appSdk.initializeApp({apiKey:'AIzaSyCZd7_oYAOcGejJIj4FPz6n_t_x1yVk32g',authDomain:'blur-finance.firebaseapp.com',projectId:'blur-finance',appId:'1:522617410666:web:affaf428082e458dc6e613'});
  auth=sdk.getAuth(app);auth.languageCode='pt-BR';
  sdk.onAuthStateChanged(auth,user=>{generation++;state.user=user;state.challenge=null;state.status=null;state.rows=[];state.error='';state.notice='';state.busy=false;render();if(user)void refresh();});
}catch{state.busy=false;state.error='Não foi possível carregar o login. Confira sua conexão e recarregue a página.';el('status-title').textContent='Acesso temporariamente indisponível';el('actions').replaceChildren(button('Recarregar página',()=>location.reload(),{disabled:false}));el('message').className='error';el('message').textContent=state.error;}
