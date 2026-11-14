/* ===== انتظار البث والتوقف =====
   • عند أي توقف نعيد تشغيل القناة إعادة كاملة كأنك ضغطت OK عليها (play من الصفر)، ولا نغيّر القناة تلقائياً أبداً.
   • سلّم تصعيد: نشطة (دقيقتان: 2 · 3 · 6 · 12 · 30 ث) ← هادئة (محاولة كل دقيقة) ← سكون (نحرّر المشغّل ونترك التلفاز ينام).
   • عودة البث: تصاعد الصوت تدريجياً، وبعد انقطاع طويل بلا أحد أمام الشاشة يعود صامتاً حتى يضغط المستخدم أي زر.
   • الأرقام الافتراضية متوازنة، وتُضبط من الإعدادات ← التشغيل ← خيارات متقدمة. */
(function(){
  const box=$('ldg'),v=$('v'),nm=$('ldgn'),st=$('ldgs'),lg=$('ldgl'),hint=box.querySelector('.ldh'),B=document.body;

  /* ---- الإعدادات (تُقرأ عند كل استعمال، والغائب يأخذ الافتراضي) ---- */
  const num=(k,d)=>{const x=+LS.get(k,d);return Number.isFinite(x)&&x>=0?x:d};
  const cfg={
    stallMs:()=>Math.max(3,num('m3u_stall_s',10))*1000,   // مهلة التجمّد
    sleepMs:()=>num('m3u_sleep_min',30)*60000,            // 0 = لا تسكن أبداً
    quiet:()=>LS.get('m3u_quiet_return',true)!==false,    // العودة صامتة بعد انقطاع طويل
    ramp:()=>LS.get('m3u_vol_ramp',true)!==false          // تصاعد الصوت عند عودة البث
  };
  const ACTIVE_MS=120000,QUIET_EVERY=60000,SLEEP_PROBE=300000,QUIET_RETURN_MS=600000,RAMP_MS=3000;
  const LADDER=[2000,3000,6000,12000,30000];
  const isVod=()=>B.classList.contains('cine-play');

  let cur=null,slow=null,gone=null,stallTimer=null,watchdog=null,lastTime=0,lastAdvance=0,hasPlayed=false;
  let retryT=null,countT=null,failStart=null,attempt=0,sleeping=false,autoPlay=false,lastInput=0,resumeAt=0,seekH=null;
  let volHeld=false,volBefore=1,rampT=null,mutedByUs=false,badge=null;

  const clearWait=()=>{clearTimeout(slow);clearTimeout(gone);clearTimeout(stallTimer);slow=gone=stallTimer=null};
  const hide=()=>{box.classList.remove('on','bad','sleep','cd');clearWait()};
  const keepAwake=on=>{try{if(window.Android&&Android.keepAwake)Android.keepAwake(!!on)}catch(e){}};

  /* ---- الصوت: نمسكه عند الصفر أثناء الانقطاع، ونرفعه تدريجياً عند العودة ---- */
  function holdVolume(){
    if(!cfg.ramp()||volHeld)return;
    volBefore=v.volume>0?v.volume:1;volHeld=true;clearInterval(rampT);rampT=null;v.volume=0;
  }
  function releaseVolume(now){
    clearInterval(rampT);rampT=null;
    if(!volHeld)return;
    if(now||!cfg.ramp()){v.volume=volBefore;volHeld=false;return}
    const t0=performance.now(),to=volBefore;
    rampT=setInterval(()=>{
      const k=Math.min(1,(performance.now()-t0)/RAMP_MS);
      v.volume=to*k;
      if(k>=1){clearInterval(rampT);rampT=null;volHeld=false}
    },100);
  }
  function showBadge(on){
    if(!badge){badge=document.createElement('div');badge.id='sndbadge';badge.textContent='🔇 عاد البث — اضغط أي زر لتشغيل الصوت';document.body.appendChild(badge)}
    badge.classList.toggle('on',!!on);
  }
  function unmuteNow(){mutedByUs=false;showBadge(false);v.muted=false;releaseVolume(false)}

  /* ---- شاشة التعذّر: حلقة عدّ تنازلي وعبارة واضحة، لا واجهة ميتة ---- */
  function showBad(msg,delay,quiet){
    const until=Date.now()+delay;
    box.classList.remove('cd','sleep');box.classList.add('on','bad');
    box.style.setProperty('--cd',(delay/1000)+'s');
    void box.offsetWidth;box.classList.add('cd');
    const tick=()=>{
      const s=Math.max(0,Math.ceil((until-Date.now())/1000));
      st.textContent=(quiet?'البث منقطع، نعيد المحاولة تلقائياً':msg)+' · إعادة التشغيل بعد '+(s>=60?Math.ceil(s/60)+' د':s+' ث');
    };
    tick();clearInterval(countT);countT=setInterval(tick,1000);
    if(hint)hint.textContent='OK القنوات · ↑ ↓ قناة أخرى · ← → إعادة الآن';
  }

  /* ---- مراحل الانقطاع ---- */
  function phase(){
    const el=Date.now()-failStart,sl=cfg.sleepMs();
    if(el<ACTIVE_MS)return 'active';
    if(isVod())return 'sleep';                 // الفيلم لا يُترك ساعات: إيقاف بعد المرحلة النشطة
    if(sl>0&&el>=sl)return 'sleep';
    return 'quiet';
  }
  function onFail(msg){
    if(!cur||retryT)return;
    if(sleeping){enterSleep();return}
    if(failStart===null){failStart=Date.now();attempt=0;if(hasPlayed&&v.currentTime>0)resumeAt=v.currentTime}
    holdVolume();clearWait();hasPlayed=false;
    const p=phase();
    if(p==='sleep'){enterSleep();return}
    const delay=p==='active'?LADDER[Math.min(attempt,LADDER.length-1)]:QUIET_EVERY;
    showBad(msg,delay,p==='quiet');
    retryT=setTimeout(()=>{retryT=null;restart()},delay);
  }
  function enterSleep(){
    clearWait();clearTimeout(retryT);retryT=null;clearInterval(countT);countT=null;
    hasPlayed=false;
    if(!sleeping){sleeping=true;keepAwake(false)}
    tok++;try{stopAll()}catch(e){}
    releaseVolume(true);
    box.classList.remove('cd');box.classList.add('on','bad','sleep');
    st.textContent=isVod()?'توقف التشغيل. اضغط أي زر للمتابعة':'توقف التشغيل لانقطاع البث. اضغط أي زر للمتابعة';
    if(hint)hint.textContent='اضغط أي زر للمتابعة';
    if(!isVod())retryT=setTimeout(()=>{retryT=null;if(sleeping&&cur)restart()},SLEEP_PROBE);   // محاولة صامتة بعيدة المدى
  }
  function leaveSleep(){if(!sleeping)return;sleeping=false;keepAwake(true);box.classList.remove('sleep')}
  function wake(byUser){
    leaveSleep();clearTimeout(retryT);retryT=null;
    if(byUser){failStart=Date.now();attempt=0}
    restart();
  }
  function retryNow(){
    clearTimeout(retryT);retryT=null;
    if(sleeping){wake(true);return}
    if(failStart===null){failStart=Date.now();attempt=0}
    restart();
  }

  /* إعادة التشغيل: هي نفسها play(it) التي يستدعيها OK (تُتلف المشغّل وتفتح اتصالاً جديداً) */
  function restart(){
    clearTimeout(retryT);retryT=null;clearInterval(countT);countT=null;
    if(!cur)return;
    if(failStart===null){failStart=Date.now();attempt=0}
    attempt++;
    const it=cur,vod=isVod();
    holdVolume();
    if(!vod&&cfg.quiet()&&Date.now()-failStart>=QUIET_RETURN_MS&&lastInput<failStart){v.muted=true;mutedByUs=true}
    if(seekH){v.removeEventListener('loadedmetadata',seekH);seekH=null}
    if(vod&&resumeAt>5){
      const at=resumeAt;
      seekH=()=>{v.removeEventListener('loadedmetadata',seekH);seekH=null;if(Number.isFinite(v.duration)&&v.duration>at)v.currentTime=at};
      v.addEventListener('loadedmetadata',seekH);
    }
    autoPlay=true;window.__autoRestart=true;
    try{show(it,true);play(it)}finally{autoPlay=false;window.__autoRestart=false}
  }
  function recovered(){
    const t0=failStart;failStart=null;attempt=0;
    clearTimeout(retryT);retryT=null;clearInterval(countT);countT=null;
    leaveSleep();
    const down=Date.now()-t0;
    if(!mutedByUs&&!isVod()&&cfg.quiet()&&down>=QUIET_RETURN_MS&&lastInput<t0){v.muted=true;mutedByUs=true}
    if(mutedByUs)showBadge(true);else releaseVolume(false);
  }
  /* تشغيل جديد من المستخدم (أو من أي وحدة أخرى): نبدأ نظيفاً */
  function resetOutage(){
    clearTimeout(retryT);retryT=null;clearInterval(countT);countT=null;
    failStart=null;attempt=0;
    leaveSleep();
    if(mutedByUs){mutedByUs=false;showBadge(false);v.muted=false}
    releaseVolume(true);
  }

  function show(it,retry){
    if(!cur||cur.url!==it.url)resumeAt=0;
    cur=it;hasPlayed=false;lastTime=0;lastAdvance=Date.now();
    nm.textContent=it.name;
    if(it.logo){lg.src=it.logo;lg.style.display=''}else lg.style.display='none';
    st.textContent=retry?'جارٍ إعادة التشغيل…':'';
    box.classList.remove('bad','sleep','cd');box.classList.add('on');
    clearWait();
    slow=setTimeout(()=>{if(box.classList.contains('on')&&!box.classList.contains('bad'))st.textContent='الاتصال بطيء';},12000);
    gone=setTimeout(()=>{gone=null;onFail('تعذّر تشغيل القناة')},Math.max(8000,cfg.stallMs())+(retry?2000:0));
  }
  lg.onerror=()=>{lg.style.display='none'};

  /* ---- أحداث المشغّل ---- */
  v.addEventListener('playing',()=>{
    hasPlayed=true;lastTime=v.currentTime;lastAdvance=Date.now();hide();
    if(failStart!==null)recovered();
  });
  function buffering(){
    if(!cur||v.paused||v.ended||sleeping)return;
    clearTimeout(stallTimer);
    stallTimer=setTimeout(()=>{
      if(cur&&!v.paused&&!v.ended&&v.readyState<3)onFail('توقف البث');
    },cfg.stallMs());
  }
  v.addEventListener('waiting',buffering);
  v.addEventListener('stalled',buffering);
  v.addEventListener('error',()=>{if(cur)onFail('تعذّر تشغيل القناة')});
  v.addEventListener('ended',()=>{if(cur&&!isVod())onFail('انتهى البث')});   // نهاية الفيلم طبيعية وتتولاها المكتبة
  v.addEventListener('timeupdate',()=>{
    if(!cur||v.paused||v.ended)return;
    if(v.currentTime!==lastTime){lastTime=v.currentTime;lastAdvance=Date.now();if(hasPlayed&&v.currentTime>0)resumeAt=v.currentTime}
  });
  watchdog=setInterval(()=>{
    if(!cur||!hasPlayed||v.paused||v.ended||sleeping||retryT||box.classList.contains('bad'))return;
    if(Date.now()-lastAdvance>Math.round(cfg.stallMs()*1.5))onFail('توقف البث');
  },3000);

  /* ---- عودة الشبكة أو التطبيق: لا ننتظر المؤقت ---- */
  function nudge(){
    if(!cur||failStart===null)return;
    if(sleeping){wake(false);return}
    clearTimeout(retryT);retryT=null;restart();
  }
  window.addEventListener('online',()=>setTimeout(nudge,1500));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)nudge()});

  /* ---- اللمس والأزرار ---- */
  const canRetryKey=()=>!B.classList.contains('menu')&&!isVod()&&!document.querySelector('dialog[open]')
    &&!(window.__stOn&&window.__stOn())&&!(window.__qpOn&&window.__qpOn())&&!(window.__vodOn&&window.__vodOn())&&!(window.WasslaHome&&WasslaHome.isOn());
  window.addEventListener('keydown',e=>{
    lastInput=Date.now();
    if(sleeping){e.preventDefault();e.stopPropagation();wake(true);return}
    if(mutedByUs){e.preventDefault();e.stopPropagation();unmuteNow();return}
    if(box.classList.contains('bad')&&(e.key==='ArrowLeft'||e.key==='ArrowRight')&&canRetryKey()){e.preventDefault();e.stopPropagation();retryNow()}
  },true);
  ['pointerdown','click'].forEach(ev=>window.addEventListener(ev,()=>{lastInput=Date.now();if(mutedByUs)unmuteNow()},true));

  /* ---- ربط play ---- */
  const _p=play;
  play=function(it){
    if(autoPlay)return _p(it);
    resetOutage();
    if(box.classList.contains('bad')||!(it&&it.url===curUrl&&!v.paused))show(it);
    return _p(it);
  };
  const _m=window.setMsg;
  window.setMsg=function(t,err){
    _m(t,err);
    if(err&&cur&&box.classList.contains('on'))onFail('تعذّر تشغيل القناة');
  };
  $('ldgr').onclick=retryNow;
  $('ldgb').onclick=()=>{
    hide();
    if(window.__rcvOpen)window.__rcvOpen();
    else if(window.__openQuick)window.__openQuick();
  };
  window.__ldgBad=()=>box.classList.contains('bad');
  window.__ldgRetry=retryNow;
  $('ldgx').onclick=()=>{if(typeof window.step==='function')step(1)};
  window.addEventListener('beforeunload',()=>{clearInterval(watchdog);clearInterval(countT);clearInterval(rampT)},{once:true});
})();
