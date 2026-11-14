/**
 * The zero-build monitoring page served at /__jobs.
 *
 * It stays plain HTML with its own embedded script on purpose: it is the one
 * surface that has to work when the renderer is the thing that broke, so it
 * shares nothing with the rest of the server and needs no build step.
 *
 * That independence stops at the figures. This is an operator's view of the
 * engine -- English labels, its own layout -- but every size and speed it prints
 * describes a transfer the user started in the window, so the units and the
 * precision follow the app's: one decimal per unit, and megabytes per second.
 * The formatters live in the embedded script only because it cannot import
 * anything; `server.dashboard.test.ts` runs that script and pins what it prints.
 */

// Zero-build monitoring page for the real filesystem engine. It is served
// straight from this file so the packaged app needs no extra assets: opening
// http://127.0.0.1:<port>/__jobs shows every transfer with live bytes, speed
// and ETA, and can pause/resume/cancel a running job from outside the app.
function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OmniCommander Pro - Transfer Engine</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#020617; color:#e2e8f0; font:13px/1.5 "Segoe UI",system-ui,sans-serif; }
  header { padding:16px 20px; border-bottom:1px solid #1e293b; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  h1 { font-size:14px; margin:0 8px 0 0; letter-spacing:.5px; color:#67e8f9; text-transform:uppercase; }
  .pill { border:1px solid #1e293b; border-radius:999px; padding:3px 10px; font-size:11px; color:#94a3b8; }
  .pill b { color:#e2e8f0; font-weight:600; }
  main { padding:18px 20px 40px; display:grid; gap:12px; }
  .job { border:1px solid #1e293b; border-radius:10px; background:#0b1220; padding:14px; }
  .job.paused { border-color:#a16207; }
  .job.done { border-color:#14532d; opacity:.72; }
  .job.done-with-errors { border-color:#7f1d1d; }
  .job.focus { border-color:#22d3ee; box-shadow:0 0 0 1px #22d3ee inset; }
  .row { display:flex; align-items:center; gap:10px; justify-content:space-between; flex-wrap:wrap; }
  .name { font-weight:600; }
  .badge { font-size:10px; text-transform:uppercase; letter-spacing:.6px; border-radius:4px; padding:2px 7px; border:1px solid currentColor; }
  .s-running { color:#22d3ee; } .s-paused { color:#fbbf24; } .s-waiting { color:#f472b6; } .s-done { color:#4ade80; }
  .s-done-with-errors, .s-error, .s-cancelled { color:#f87171; }
  .bar { height:7px; border-radius:4px; background:#1e293b; overflow:hidden; margin:10px 0 8px; }
  .fill { height:100%; background:linear-gradient(90deg,#0891b2,#22d3ee); transition:width .25s linear; }
  .fill.warn { background:linear-gradient(90deg,#b45309,#fbbf24); }
  .fill.bad { background:linear-gradient(90deg,#b91c1c,#f87171); }
  .stats { display:flex; gap:16px; flex-wrap:wrap; font-size:12px; color:#94a3b8; }
  .stats b { color:#e2e8f0; }
  .file { margin-top:8px; font-size:11px; color:#64748b; word-break:break-all; font-family:ui-monospace,Consolas,monospace; }
  .files { margin-top:6px; display:grid; gap:2px; }
  .frow { display:flex; align-items:center; gap:8px; font:11px/1.4 ui-monospace,Consolas,monospace; color:#94a3b8; }
  .frow .fn { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .frow .fb { width:110px; height:5px; background:#1e293b; border-radius:3px; overflow:hidden; flex:none; }
  .frow .fb i { display:block; height:100%; background:#22d3ee; }
  .frow .fp { width:38px; text-align:right; flex:none; }
  .frow.done .fb i { background:#4ade80; }
  .frow.done .fp { color:#4ade80; }
  .frow.skipped { color:#64748b; }
  .frow.skipped .fp, .frow.error .fp { color:#f87171; }
  .errs { margin:8px 0 0; padding:8px 10px; border-left:2px solid #b91c1c; background:#1a0d0d; border-radius:4px; font-size:11px; color:#fca5a5; }
  .errs div + div { margin-top:4px; }
  .acts { display:flex; gap:6px; }
  button { background:#111c30; color:#cbd5e1; border:1px solid #1e293b; border-radius:6px; padding:4px 10px; font-size:11px; cursor:pointer; }
  button:hover { border-color:#22d3ee; color:#67e8f9; }
  .empty { border:1px dashed #1e293b; border-radius:10px; padding:26px; text-align:center; color:#475569; }
  #link { flex:1 1 100%; background:#3b0d0d; border:1px solid #7f1d1d; color:#fecaca; border-radius:6px; padding:6px 10px; font-size:12px; }
  #link:empty { display:none; }
  .conflict { margin-top:10px; border:1px solid #7f1d1d; background:#1a0d0d; border-radius:8px; padding:10px 12px; display:grid; gap:6px; }
  .conflict b { color:#fecaca; }
  .cpaths { font:11px/1.5 ui-monospace,Consolas,monospace; color:#94a3b8; word-break:break-all; }
  .cmeta { font-size:11px; color:#94a3b8; }
  .cacts { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .capply { display:flex; align-items:center; gap:6px; font-size:11px; color:#cbd5e1; cursor:pointer; }
</style>
</head>
<body>
<header>
  <h1>OmniCommander Pro &middot; Transfer Engine</h1>
  <span class="pill">port <b id="port">-</b></span>
  <span class="pill">platform <b id="platform">-</b></span>
  <span class="pill">process up <b id="uptime">-</b></span>
  <span class="pill">active <b id="active">0</b></span>
  <div id="link"></div>
</header>
<main id="jobs"><div class="empty">Loading jobs...</div></main>
<script>
(function(){
  // The page is opened by a navigation, which cannot send a header, so the token
  // arrives in the URL once and is sent as a header from then on. The address bar is
  // put back to the plain page -- what stays there ends up in the history and in
  // every screenshot of it -- and the cookie the first visit left covers a reload.
  var token='';
  // The job the tray pointed at, when the page was opened from its row.
  var focusJob='';
  var focusShown=false;
  try{
    var params=new URLSearchParams(location.search);
    token=params.get('t')||'';
    focusJob=params.get('job')||'';
    if(!token){
      var kept=/(?:^|;\s*)omni-page=([^;]+)/.exec(document.cookie||'');
      if(kept) token=decodeURIComponent(kept[1]);
    }
    if(location.search) history.replaceState(null,'',location.pathname);
  }catch{
    /* A browser that refuses the rewrite still has the token from this load. */
  }
  function api(url, init){
    init=init||{};
    init.headers=Object.assign({}, init.headers, token?{'x-omni-token':token}:null);
    return fetch(url, init);
  }
  // "Apply to all" lives here, not in the checkbox: the list is rebuilt every
  // poll, and a tick would otherwise clear an answer the user already chose.
  var applyAll={};
  document.addEventListener('change', function(ev){
    var box=ev.target.closest('input[data-all]');
    if(box) applyAll[box.dataset.all]=box.checked;
  });
  function answer(ev){
    var btn=ev.target.closest('button[data-resolve]');
    if(!btn) return;
    var id=btn.dataset.id;
    api('/api/fs/job/'+encodeURIComponent(id)+'/resolve', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ decision:btn.dataset.resolve, applyToAll:!!applyAll[id] }),
    }).catch(function(){});
  }
  document.addEventListener('pointerdown', answer);
  document.addEventListener('click', function(ev){ if(!ev.detail) answer(ev); });
  var KB=1024, MB=KB*1024, GB=MB*1024;
  // One decimal for every unit, the same precision the app prints: a figure
  // here is a transfer the user started in the window, and the two must not
  // disagree on how exact the same number is. This page keeps its own copy of
  // the ladder rather than sharing the app's module because it ships as one
  // self-contained document with no build step (see the header of this file).
  function bytes(n){
    n=Number(n)||0;
    if(n>=GB) return (n/GB).toFixed(1)+' GB';
    if(n>=MB) return (n/MB).toFixed(1)+' MB';
    if(n>=KB) return (n/KB).toFixed(1)+' KB';
    return n+' B';
  }
  // Megabytes per second, one decimal, and no trailing zero on a whole figure:
  // the same shape the app shows, so a job read here and the same job read in
  // the window cannot name its speed in units the other never prints.
  function speed(bps){
    var t=((Number(bps)||0)/MB).toFixed(1);
    return (t.slice(-2)==='.0'?t.slice(0,-2):t)+' MB/s';
  }
  // The percentage both bars divide out of two reported counts. Coercing first
  // is what keeps a count that never arrived from reaching the page as "NaN%",
  // and the cap stops a copied total that overtook its size from overflowing.
  function pctOf(copied, total){
    var c=Number(copied)||0, t=Number(total)||0;
    return t>0?Math.min(100, Math.round(c/t*100)):0;
  }
  function dur(s){
    s=Math.round(Number(s)||0);
    if(s<=0) return '-';
    if(s<60) return s+'s';
    var m=Math.floor(s/60), r=s%60;
    if(m<60) return m+'m '+r+'s';
    return Math.floor(m/60)+'h '+(m%60)+'m';
  }
  function esc(v){
    return String(v==null?'':v).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  var ORDER={running:0,waiting:0,paused:1,'done-with-errors':2,error:2,cancelled:3,done:4};
  // The prompt for a job the engine parked. Without it a transfer waiting on a
  // collision could only be answered with the window open, which is the one thing
  // this page exists to avoid.
  function conflict(j){
    var c=j.pendingConflict;
    if(!c) return '';
    return '<div class="conflict">'+
      '<div>Destination already exists. Answer it here to let the transfer go on:</div>'+
      '<div class="cpaths">'+esc(c.source)+' &rarr; '+esc(c.destination)+'</div>'+
      '<div class="cmeta">'+bytes(c.sourceSize)+' / '+bytes(c.destinationSize)+
        (c.identical?' &middot; identical':'')+'</div>'+
      '<div class="cacts">'+
        '<button data-resolve="overwrite" data-id="'+esc(j.id)+'">Overwrite</button>'+
        '<button data-resolve="skip" data-id="'+esc(j.id)+'">Skip</button>'+
        '<button data-resolve="rename" data-id="'+esc(j.id)+'">Rename</button>'+
        '<label class="capply"><input type="checkbox" data-all="'+esc(j.id)+'"'+
          (applyAll[j.id]?' checked':'')+'> Apply to all</label>'+
      '</div></div>';
  }
  function render(list){
    var host=document.getElementById('jobs');
    // The rebuild replaces every button, so the one the keyboard sits on would
    // take the focus with it; what can be found again is the action it stands for.
    var on=document.activeElement;
    var focused=on && on.dataset && on.dataset.act ? on.dataset.id+'/'+on.dataset.act : null;
    if(!list.length){ host.innerHTML='<div class="empty">No transfer jobs yet. Start a copy or move in the app.</div>'; return; }
    list.sort(function(a,b){
      var d=(ORDER[a.status]==null?9:ORDER[a.status])-(ORDER[b.status]==null?9:ORDER[b.status]);
      return d!==0?d:(b.startedAt||0)-(a.startedAt||0);
    });
    host.innerHTML=list.map(function(j){
      var pct=pctOf(j.copiedBytes, j.totalBytes);
      var cls=j.status==='done'?'done':(j.status==='paused'?'paused':(j.status==='done-with-errors'||j.status==='error'?'done-with-errors':''));
      var fillCls=j.status==='paused'?'warn':((j.status==='done-with-errors'||j.status==='error')?'bad':'');
      var canAct=j.status==='running'||j.status==='paused'||j.status==='waiting';
      var btns=canAct?('<div class="acts">'+
          (j.status==='paused'
            ? '<button data-act="resume" data-id="'+esc(j.id)+'">Resume</button>'
            : (j.status==='running'
              ? '<button data-act="pause" data-id="'+esc(j.id)+'">Pause</button>'
              : ''))+
          '<button data-act="cancel" data-id="'+esc(j.id)+'">Cancel</button></div>'):'';
      var errs=(j.errors&&j.errors.length)?('<div class="errs">'+j.errors.map(function(e){
        return '<div>'+esc(e.path||'(job)')+' &mdash; '+esc(e.message)+'</div>';
      }).join('')+'</div>'):'';
      // Newest rows first: the file being written right now is always on top.
      var recent=(j.recentFiles||[]).slice(-6).reverse();
      var files=recent.length?('<div class="files">'+recent.map(function(f){
        var fp=pctOf(f.copied, f.size);
        var right=f.status==='skipped'?'skip':(f.status==='error'?'fail':fp+'%');
        return '<div class="frow '+esc(f.status)+'"><span class="fn">'+esc(f.name)+'</span>'+
          '<span class="fb"><i style="width:'+fp+'%"></i></span>'+
          '<span class="fp">'+right+'</span></div>';
      }).join('')+'</div>'):'';
      return '<section class="job '+cls+(j.id===focusJob?' focus':'')+'">'+
        '<div class="row"><div><span class="badge s-'+esc(j.status)+'">'+esc(j.status)+'</span> '+
        '<span class="name">'+esc(j.label)+'</span> <span class="pill">'+esc(j.op)+'</span></div>'+btns+'</div>'+
        '<div class="bar"><div class="fill '+fillCls+'" style="width:'+pct+'%"></div></div>'+
        '<div class="stats">'+
          '<span>progress <b>'+pct+'%</b></span>'+
          '<span>copied <b>'+bytes(j.copiedBytes)+'</b> / '+bytes(j.totalBytes)+'</span>'+
          '<span>speed <b>'+(j.status==='running'&&j.speedBps>0?speed(j.speedBps):'-')+'</b></span>'+
          '<span>eta <b>'+dur(j.etaSeconds)+'</b></span>'+
          '<span>items <b>'+(j.itemsDone||0)+'</b> / '+(j.itemsTotal||0)+'</span>'+
          (j.itemsSkipped?'<span>skipped <b>'+j.itemsSkipped+'</b></span>':'')+
        '</div>'+
        (j.currentFile?'<div class="file">'+esc(j.currentFile)+'</div>':'')+
        files+
        conflict(j)+
        errs+
      '</section>';
    }).join('');
    if(focused){
      var drawn=host.querySelectorAll('button[data-act]');
      for(var f=0;f<drawn.length;f+=1){
        if(drawn[f].dataset.id+'/'+drawn[f].dataset.act===focused){ drawn[f].focus({preventScroll:true}); break; }
      }
    }
    // Dragged into view once, not on every poll: the list is rebuilt every 600 ms, and
    // a page that kept jumping back would fight whoever scrolled away.
    if(focusJob && !focusShown){
      focusShown=true;
      var target=host.querySelector('section.focus');
      if(target && target.scrollIntoView) target.scrollIntoView({block:'center'});
    }
  }
  // A browser drops the click when the pressed button is replaced before the
  // release, and this list is rebuilt every 600 ms; the press also names the job
  // under the cursor, which a release after a reorder would not. Keyboard
  // activation is a click with no pointer detail.
  function act(ev){
    var btn=ev.target.closest('button[data-act]');
    if(!btn) return;
    api('/api/fs/job/'+encodeURIComponent(btn.dataset.id)+'/'+btn.dataset.act, { method:'POST' }).catch(function(){});
  }
  document.addEventListener('pointerdown', act);
  document.addEventListener('click', function(ev){ if(!ev.detail) act(ev); });
  var lastMeta=0;
  // A page left open outlives the engine: a restart binds another port and mints
  // another token, so every request starts failing while the rows from the last
  // answer stay on screen looking current. The banner is what says they are not.
  var offline=false;
  function linkState(lost){
    if(lost===offline) return;
    offline=lost;
    document.getElementById('link').textContent=lost?'Engine unreachable — what is left below is the last it reported.':'';
  }
  function tick(){
    api('/api/fs/jobs').then(function(r){
      if(!r.ok) throw new Error('status '+r.status);
      return r.json();
    }).then(function(list){ linkState(false); render(list); }).catch(function(){ linkState(true); });
    var now=Date.now();
    if(now-lastMeta>2000){
      lastMeta=now;
      api('/api/fs/dashboard').then(function(r){return r.json();}).then(function(m){
        document.getElementById('port').textContent=m.port;
        document.getElementById('platform').textContent=m.platform;
        document.getElementById('uptime').textContent=dur(m.uptimeSeconds);
        document.getElementById('active').textContent=m.activeCount;
      }).catch(function(){});
    }
  }
  var timer=null;
  function start(){
    if(timer) return;
    tick();
    timer=setInterval(tick,600);
  }
  function stop(){
    if(!timer) return;
    clearInterval(timer);
    timer=null;
  }
  // A hidden tab has nothing to show and no reason to keep the engine working.
  document.addEventListener('visibilitychange', function(){
    if(document.hidden) stop(); else start();
  });
  start();
})();
</script>
</body>
</html>`;
}

module.exports = { dashboardHtml };
