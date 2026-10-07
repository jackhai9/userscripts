// ==UserScript==
// @name         Binance Chart Mirror Native Preflight (Experiment)
// @namespace    binance.chart.mirror.native-preflight
// @version      0.0.1
// @description  Observe pinned mirror startup and native dispatch counts without custom storage writes.
// @match        https://www.binance.com/zh-CN/futures/USUSDT
// @run-at       document-start
// @sandbox      raw
// @grant        none
// @noframes
// ==/UserScript==
(() => {
  // experiments/binance-chart-storage/bootstrap.js
  var QUEUE_NAME = "webpackChunkfutures_trade_ui";
  function observeChartStorageBootstrap({ onCapture, replaceMirrorFactory } = {}) {
    const lab = location.origin === "https://chart-storage.test";
    const incidentPage = location.origin === "https://www.binance.com" && location.pathname === "/zh-CN/futures/USUSDT" && self === top;
    if (!lab && !incidentPage) throw new Error("Storage bootstrap requires the lab or the top-level USUSDT incident page");
    if (onCapture !== void 0 && typeof onCapture !== "function") throw new Error("onCapture must be a synchronous function");
    if (replaceMirrorFactory !== void 0 && typeof replaceMirrorFactory !== "function") throw new Error("replaceMirrorFactory must be a synchronous function");
    const moduleId = replaceMirrorFactory === void 0 ? "43917" : "70940";
    const globalDescriptor = Object.getOwnPropertyDescriptor(self, QUEUE_NAME);
    if (globalDescriptor && !Object.hasOwn(globalDescriptor, "value")) throw new Error("Storage bootstrap requires a native queue property");
    const queue = globalDescriptor && globalDescriptor.value !== void 0 ? globalDescriptor.value : [];
    const nativeAppend = Array.prototype.push;
    if (!Array.isArray(queue) || queue.length !== 0 || queue.push !== nativeAppend || Object.hasOwn(queue, "push")) {
      throw new Error("Storage bootstrap must start before runtime on a native empty queue");
    }
    if (globalDescriptor && globalDescriptor.value === void 0 && !globalDescriptor.configurable) {
      throw new Error("Storage bootstrap cannot own the existing global queue property");
    }
    const createdQueue = !globalDescriptor || globalDescriptor.value === void 0;
    if (createdQueue) Object.defineProperty(self, QUEUE_NAME, { value: queue, writable: true, configurable: true, enumerable: true });
    let runtimePush;
    let inFlightAppends = 0;
    let active = true;
    let originalFactory;
    let observedFactory;
    let observedChunk;
    let runtimeRequire;
    let resolveCapture;
    let rejectCapture;
    const captured = new Promise((resolve, reject) => {
      resolveCapture = resolve;
      rejectCapture = reject;
    });
    function restore() {
      if (runtimeRequire && runtimeRequire.m[moduleId] === observedFactory) runtimeRequire.m[moduleId] = originalFactory;
      if (observedChunk && observedChunk[1][moduleId] === observedFactory) observedChunk[1][moduleId] = originalFactory;
      const descriptor = Object.getOwnPropertyDescriptor(queue, "push");
      if (!descriptor || descriptor.get !== getPush || descriptor.set !== setPush || !descriptor.configurable) {
        throw new Error("Storage bootstrap lost queue accessor ownership");
      }
      if (runtimePush) {
        Object.defineProperty(queue, "push", { value: runtimePush, writable: true, configurable: true, enumerable: true });
      } else {
        delete queue.push;
        if (createdQueue && inFlightAppends === 0 && queue.length === 0 && Object.getOwnPropertyDescriptor(self, QUEUE_NAME)?.value === queue) {
          if (globalDescriptor) Object.defineProperty(self, QUEUE_NAME, globalDescriptor);
          else delete self[QUEUE_NAME];
        }
      }
    }
    function finish(succeeded, result) {
      if (!active) return;
      active = false;
      try {
        restore();
      } catch (cleanupError) {
        if (succeeded) {
          succeeded = false;
          result = cleanupError;
        }
      }
      if (succeeded) resolveCapture(result);
      else rejectCapture(result);
    }
    function prepareChunk(chunk) {
      if (!active) return chunk;
      try {
        if (!Array.isArray(chunk) || !Array.isArray(chunk[0]) || !chunk[1] || typeof chunk[1] !== "object") {
          throw new Error("Storage bootstrap observed an unsupported chunk shape");
        }
        if (!Object.hasOwn(chunk[1], moduleId)) return chunk;
        if (originalFactory) throw new Error("Storage module registered twice before capture");
        originalFactory = chunk[1][moduleId];
        if (typeof originalFactory !== "function") throw new Error("Storage module factory must be a function");
        const hostRuntime = chunk[2];
        if (hostRuntime !== void 0 && typeof hostRuntime !== "function") throw new Error("Storage chunk runtime callback must be a function");
        const executionFactory = replaceMirrorFactory === void 0 ? originalFactory : replaceMirrorFactory(originalFactory);
        if (!active) return chunk;
        if (typeof executionFactory !== "function") throw new Error("Mirror replacement must return a factory synchronously");
        observedFactory = function(module, exports, require2) {
          runtimeRequire = require2;
          let returned;
          try {
            returned = executionFactory.call(this, module, exports, require2);
          } catch (hostError) {
            finish(false, hostError);
            throw hostError;
          }
          if (active) {
            try {
              const result = onCapture === void 0 ? void 0 : onCapture(module.exports);
              if (result && typeof result.then === "function") throw new Error("Storage observation callback must complete synchronously");
              finish(true, module.exports);
            } catch (observationError) {
              finish(false, observationError);
            }
          }
          return returned;
        };
        observedChunk = [chunk[0], { ...chunk[1], [moduleId]: observedFactory }, (require2) => {
          runtimeRequire = require2;
          if (hostRuntime !== void 0) return hostRuntime(require2);
        }];
        return observedChunk;
      } catch (observationError) {
        finish(false, observationError);
        return chunk;
      }
    }
    function preRuntimePush(...chunks) {
      if (!active || runtimePush) return nativeAppend.apply(this, chunks);
      inFlightAppends += 1;
      try {
        return nativeAppend.apply(this, chunks.map(prepareChunk));
      } finally {
        inFlightAppends -= 1;
      }
    }
    function runtimeObservingPush(chunk) {
      return runtimePush.call(this, prepareChunk(chunk));
    }
    function getPush() {
      return runtimePush ? runtimeObservingPush : preRuntimePush;
    }
    function setPush(dispatcher) {
      if (!active) {
        Object.defineProperty(queue, "push", { value: dispatcher, writable: true, configurable: true, enumerable: true });
        return;
      }
      if (runtimePush || typeof dispatcher !== "function") {
        finish(false, new Error("Storage bootstrap observed an unexpected push replacement"));
        Object.defineProperty(queue, "push", { value: dispatcher, writable: true, configurable: true, enumerable: true });
        return;
      }
      runtimePush = dispatcher;
    }
    Object.defineProperty(queue, "push", { get: getPush, set: setPush, enumerable: true, configurable: true });
    return Object.freeze({
      captured,
      stop() {
        finish(false, new Error("Storage bootstrap stopped before module execution"));
      }
    });
  }

  // experiments/binance-chart-storage/mirror-module.js
  var originalFactorySource = '70940(Z,x,e){"use strict";e.r(x),e.d(x,{TradingView:()=>Dt,default:()=>Cn});var o=e(49253),v=e(77135),d=e(75510),i=e(42288),p=e(31085),r=e(41594),M=e(43917),h=e.n(M),P=e(81936),b=e.n(P),V=e(7980),U=e.n(V),D=e(76469),c=e(4260),k=e(53837),B=e(27571),C=e(45250),y=e(87646),A=e.n(y),q=e(80817);const E=(0,C.range)(1,1380),m=(0,C.range)(1,365).map(t=>`${t}D`),R=(0,C.range)(1,52).map(t=>`${t}W`),I=(0,C.range)(1,12).map(t=>`${t}M`),F=["1S",...E,...m,...R,...I],L=({symbol:t,params:n})=>{const a=new URLSearchParams(n);return`${t}@${a.toString()}`},X=t=>{const[n,a]=t.split("@"),s=new URLSearchParams(a).entries(),g=A()(Array.from(s));return{symbol:n,params:g}},ue=()=>{const t=new Map;let n={},a=[],u={onReady:()=>null,resolveSymbol:()=>null,searchSymbols:()=>null,getBars:()=>null,subscribeBars:()=>null,unsubscribeBars:()=>null};return({config:s,onSymbolResolving:g,onSymbolResolved:S,onFetchSymbolsInfo:K,onFetchBars:Y,onSubscribeBars:H,onUnsubscribeBars:j,onFetchServerTimeApi:$,onTransformSymbolInfo:f=({template:T})=>T,onSearchSymbols:l=()=>!0})=>(u={onReady:T=>{setTimeout(async()=>{const _=(await K()).map(O=>({...O,ticker:L({symbol:O.symbol,params:O.params||{}})}));a=_.map(({ticker:O,symbol:G,description:te="",exchange:J="",type:oe=""})=>({symbol:G,ticker:O,description:te,exchange:J,type:oe})),n=(0,C.keyBy)(_,"ticker"),T({exchanges:[],symbols_types:[],supported_resolutions:F,supports_marks:!1,supports_timescale_marks:!1,supports_time:!0,...s})})},resolveSymbol:async(T,W,_)=>{const O=n[T];if(!O){_(`cannot resolve symbol - ${T}`);return}const G=f({info:O,template:{description:O.description||"",fractional:!1,has_seconds:!0,seconds_multipliers:["1"],has_intraday:!0,intraday_multipliers:["1","3","5","15","30","60","120","240","360","480","720"],has_daily:!0,daily_multipliers:["1"],has_weekly_and_monthly:!0,weekly_multipliers:["1"],monthly_multipliers:["1"],minmov:1,minmove2:0,name:O.symbol,ticker:O.ticker,timezone:"Etc/UTC",pricescale:O.tickSize,session:"24x7",type:O.type||"",exchange:O.exchange||"",listed_exchange:O.exchange||"",format:"price",supported_resolutions:F,visible_plots_set:"ohlcv",volume_precision:3}});if(g){const te=X(G.ticker||"");if(!await g({symbol:T,info:G,tickerInfo:te})){_(`symbol resolving error - ${T}`);return}}setTimeout(()=>{W(G),S?.(G)})},searchSymbols:(T,W,_,O)=>{const G=new RegExp(T,"i"),te=new RegExp(W,"i"),J=new RegExp(_,"i"),oe=a.filter(Te=>{const{symbol:N,ticker:w,description:re="",exchange:ie="",type:le=""}=Te;return[N,w,re].some(de=>G.test(de||""))&&te.test(ie)&&J.test(le)&&l?.({item:Te})});O(oe)},getBars:async(T,W,_,O,G)=>{const{from:te,to:J,firstDataRequest:oe}=_,Te=(0,q.Cz)(W);try{if(J>=0){const N=X(T.ticker||""),w=await Y({symbolInfo:T,resolution:W,rangeStartDate:te,rangeEndDate:J,tickerInfo:N,binanceInterval:Te,firstDataRequest:oe});O(w,{noData:w.length===0})}else O([],{noData:!0})}catch(N){G(N.toString())}},subscribeBars:(T,W,_,O,G)=>{const te=X(T.ticker||""),J=(0,q.Cz)(W),oe=H({symbolInfo:T,resolution:W,callback:_,onResetCacheNeededCallback:G,tickerInfo:te,binanceInterval:J});t.set(O,oe)},unsubscribeBars:T=>{t?.get(T)?.(),t?.delete(T),j?.(T)},getServerTime:async T=>{try{const W=await $();T(W)}catch(W){console.warn(W),T(Date.now()/1e3)}}},{datafeed:u,observers:t,symbolsInfo:n})},Le=({namespace:t,type:n})=>{const a=(0,r.useMemo)(()=>h().createInstance({name:t}),[t]);return(0,r.useCallback)(()=>{n==="tv"&&a.removeItem("myTradingView")},[a,n])};var Ue=e(76535),pr=e(26531),Ye=e(17409),Qe=e(94652),Ae=e(76830),he=e(48651),Fe=e(79344),se=e(51029),Je=e(36307),or=e(25379),yr=e(44745),Ne=e(15727),rr=e(45358),sr=e(82071),Ve=e(85411),ge=e(94889),hr=e(94547),tr=e(80686),Ar=e(61875);function Fr(t){return(0,ge._)(t)||(0,hr._)(t)||(0,Ar._)(t)||(0,tr._)()}var Nr=e(92873),zr=e(35630),Vr=e(12055),Qr=e(79515),Br=e(80737),Jr=e(40545),Zr=e(98107),Kr=e(51846),Xr="Chart.Crosshair.PlusButton.DrawHorizontalLine",wr=function(t){var n=t.namespace,a=t.symbol,u=t.priceType,s=t.crosshairPrice,g=(0,Nr.o)("","kline-ui").getI18n,S=(0,Vr.r)().format,K=k.y$(n),Y=(0,Br.S)({namespace:n}),H=(0,Jr.hw)(),j=(0,Zr.c)(),$=(0,Qr.nH)(),f=(0,se.Ye)(),l=(0,Kr.E)({symbol:a}),T=(0,Fe.f0)(a),W=T.isCM,_=(0,r.useRef)(s);(0,r.useEffect)(function(){_.current=s},[s]);var O=(0,r.useRef)(H);(0,r.useEffect)(function(){O.current=H},[H]);var G=(0,r.useRef)(j);(0,r.useEffect)(function(){G.current=j},[j]);var te=(0,r.useRef)(u);(0,r.useEffect)(function(){te.current=u},[u]);var J=(0,r.useRef)($);(0,r.useEffect)(function(){J.current=$},[$]);var oe=(0,r.useRef)(f);(0,r.useEffect)(function(){oe.current=f},[f]);var Te=(0,r.useRef)(l);(0,r.useEffect)(function(){Te.current=l},[l]);var N=(0,r.useRef)(W);return(0,r.useEffect)(function(){N.current=W},[W]),{items_processor:(function(){var w=(0,o._)(function(re,ie,le){var de,Be,ve,Ce,ce,Ke,Ze,Ge,Xe,Ie,He,ur,Tr,_r,Cr;return(0,i._)(this,function(Er){if(Be=K.getState().tradingViewReference,!Be)return console.warn("[context-menu] trading view reference is not found"),[2,re];if(Be.chartsCount()>1)return[2,re];if(ve=Be.activeChart().symbolExt(),!ve)return[2,re];switch(Ce=ve.name,ce=_.current,Ke=le.menuName==="CrosshairMenuView"?"chart-trading":"context-menu",Ze={price:"".concat(ce.value),formattedPrice:ce.formatted,source:Ke,chartType:"tradingview"},Ge=(de=oe.current[Ce])===null||de===void 0?void 0:de.baseAsset,Xe=g("trade",{defaultValue:"Trade"}),Ie=S(ce.formatted),He=G.current&&te.current===c.SJ.Last&&J.current&&Ge?[ie.createAction({actionId:"Chart.PlaceOrder.BuyLimit",label:"".concat(Xe," ").concat(Ge," @ ").concat(Ie," ").concat(g("limit",{defaultValue:"Limit"})),onExecute:function(){return Te.current.onClickBuyLimit(Ze)}}),ie.createAction({actionId:"Chart.PlaceOrder.BuyStop",label:"".concat(Xe," ").concat(Ge," @ ").concat(Ie," ").concat(g("stop",{defaultValue:"Stop"})),onExecute:function(){return Te.current.onClickBuyStop(Ze)}})]:[],ur=O.current?ie.createAction({actionId:"Chart.PriceAlert.CreateAtCrosshair",label:g("create-alert-at",{defaultValue:"Create Alert at {{price}}",price:ce.formatted}),onExecute:function(){Y({symbol:Ce,price:ce.formatted,mode:zr.n.CREATE})}}):null,re.forEach(function(we){if(!(!("execute"in we)||!("getState"in we))){var Dr=we.getState();if(Dr.actionId===Xr){var z=we.execute.bind(we);we.execute=function(){(0,Kr.A)({elementId:"draw_horizontal_line",isDelivery:N.current,chartType:"tradingview"}),z()}}}}),le.menuName){case"CrosshairMenuView":return ur?[2,[ur].concat((0,d._)(He),(0,d._)(re.slice()))]:[2,(0,d._)(He).concat((0,d._)(re.slice()))];case"ChartContextMenu":return ur?(Tr=Fr(re),_r=Tr[0],Cr=Tr.slice(1),[2,[_r,ur].concat((0,d._)(He),(0,d._)(Cr))]):[2,(0,d._)(He).concat((0,d._)(re.slice()))];default:return[2,re]}return[2]})});return function(re,ie,le){return w.apply(this,arguments)}})()}},qr=function(){var t=(0,r.useState)({value:NaN,formatted:""}),n=t[0],a=t[1],u=(0,r.useCallback)(function(s){var g=s.crosshairData,S=s.activeChart;S&&a({value:g.price,formatted:S.priceFormatter().format(g.price)})},[]);return{onCrosshairMoved:u,crosshairPrice:n}};const Hr=t=>Math.floor(Math.log10(t)),et=t=>{const[n="1"]=t.split(",");return Hr(+n)},pe=({symbolInfo:t,minTick:n})=>{const{pricescale:a=2}=t||{};return n==="default"||n===void 0?Hr(a):et(n)},br=t=>(n,a)=>{try{return n?{format:u=>{const s=pe({symbolInfo:n,minTick:a});return t.format({symbolInfo:n,minTick:a,value:u,precision:s})}}:null}catch{return null}},Mr=10**12,rt=10**9,tt=10**6,jr=10**3,gr=t=>{const n=t.toString(),[,a=""]=n.split(".");return Math.min(a.length,3)},nt=({value:t})=>{const n=Math.abs(t);if(n>=Mr){const a=t/Mr;return{value:a,unit:"T",precision:gr(a)}}if(n>=rt){const a=t/rt;return{value:a,unit:"B",precision:gr(a)}}if(n>=tt){const a=t/tt;return{value:a,unit:"M",precision:gr(a)}}if(n>=jr){const a=t/jr;return{value:a,unit:"K",precision:gr(a)}}return{value:t,unit:"",precision:gr(t)}},ut=t=>(n,a,u)=>{try{return a&&n.type==="volume"?{format:s=>s===void 0?"":t.formatVolume({format:n,symbolInfo:a,precision:u,value:s,volumeDetail:nt({value:s})})}:null}catch{return null}};var lt=function(){var t=(0,Vr.r)(),n=t.format,a=(0,r.useMemo)(function(){return br({format:function(s){var g=s.value,S=s.precision;return n(g,{precision:S})}})},[n]),u=(0,r.useMemo)(function(){return ut({formatVolume:function(s){var g=s.value,S=s.volumeDetail;if(g===void 0||!S)return"";var K=n(S.value,{precision:S.precision});return"".concat(K).concat(S.unit)}})},[n]);return{priceFormatterFactory:a,studyFormatterFactory:u}},dt=e(74069),ir=function(t){var n=(0,dt.K)(t),a=(0,r.useMemo)(function(){return n.map(function(u){var s=u.id,g=u.time,S=u.isBuy,K=u.price,Y=u.tooltip;return{id:s,text:"",price:K,quantity:"",time:Math.round(g/1e3),isBuy:S,tooltip:Y}})},[n]);return{executionOrders:a}},at=function(t){var n=t.namespace,a=t.symbol,u=(0,Br.j)({namespace:n,symbol:a});return(0,r.useMemo)(function(){return u.map(function(s){var g=s.id,S=s.price,K=s.formattedPrice,Y=s.sideText,H=s.showCloseButton,j=s.isPriceChangeable,$=s.cancelTooltipText,f=s.onClick,l=s.onCancel,T=s.onPriceChanged;return{id:g,price:+S,text:"".concat(Y," ").concat(K),editable:j,cancellable:H,cancelTooltip:$,type:c.ND.PriceAlert,onCancel:H?l:void 0,onMove:j?function(W){var _=W.price;T({currentPrice:_})}:void 0,onClick:f}})},[u])},vt=e(90664),ot=function(t){var n=t.symbol,a=(0,vt.w)({symbol:n});return(0,r.useMemo)(function(){return a.map(function(u){var s=u.id,g=u.text,S=u.price;return{id:s,text:g,price:+S,type:c.ND.BreakEvenPrice}})},[a])},cr=e(82508),ft=e(91025),mt=e(36077),Rr=function(t){var n=t.symbol,a=(0,mt.c)({symbol:n});return(0,r.useMemo)(function(){return a.map(function(u){return(0,ft._)((0,cr._)({},u),{type:c.ND.LiquidationPrice})})},[a])},pt=function(t){var n=t.namespace,a=t.symbol,u=at({namespace:n,symbol:a}),s=ot({symbol:a}),g=Rr({symbol:a});return(0,r.useMemo)(function(){return(0,d._)(u).concat((0,d._)(s),(0,d._)(g))},[u,s,g])},st=e(42902),Ir=e(90170),yt=e(63345),ht=e(48210),Pr=e(51289),xr=e(24326),$r=e(90922),kr=e(34235),it=e(63762),Ft=function(t){var n=(0,Fe.f0)(t),a=n.pricePrecision,u=n.isCM,s=(0,st.yD)(t)||{},g=s.lastPrice,S=g===void 0?"0":g,K=(0,kr.Bp)(u),Y=(0,it.HY)(t),H=(0,kr.gv)(u),j=(0,kr.WF)(u);return(0,r.useMemo)(function(){return(0,$r.qF)({orders:(0,d._)(K).concat((0,d._)(H),(0,d._)(j)),symbol:t}).map(function($){return Y({order:$,lastPrice:S,pricePrecision:a})})},[S,K,H,a,t,Y])},gt=e(31542),Tt=function(t){var n=t.type;(0,gt.u4)("webClick",{module:"chart",elementId:n})},Nt=function(t){var n=t.symbol,a=t.namespace,u=(0,r.useState)(0),s=u[0],g=u[1],S=(0,r.useCallback)(function(){return g(function(N){return N+1})},[]),K=Ft(n),Y=(0,xr.IT)({namespace:a}),H=(0,Fe.f0)(n),j=H.isDelivery,$=H.contractType,f=(0,st.yD)(n)||{},l=f.lastPrice,T=l===void 0?"0":l,W=(0,yt.s)(n),_=(0,it.YZ)({symbol:n,afterConfirmationModalIsShown:S}),O=(0,it.u8)(n),G=(0,it.jn)(n),te=(0,r.useCallback)(function(N){return(0,ht.D)({order:N,isDelivery:j,symbol:j?N.symbol:"".concat(N.symbol,"_").concat($),module:"tradingview_kline"})},[$,j]),J=(0,r.useMemo)(function(){return K.map(function(N){var w=N.order,re=N.price,ie=N.quantity,le=N.quantityText,de=N.isBuy,Be=N.text,ve=N.priceTooltipText,Ce=N.pnlText,ce=(0,Pr.$L)(w),Ke=(0,Pr.OX)(w),Ze=(0,Pr.xL)(w),Ge=ce==="LIMIT",Xe=(0,Ir.Y)(w);return{id:String(Ke),text:Be,price:+re,quantity:le,isBuy:de,editable:Xe&&G,tooltip:ve,modifyTooltip:w.closePosition||!Ge?"":void 0,onMove:G?function(Ie){var He=Ie.price;te(w),Tt({type:"TV_vertical"}),_({order:w,price:+He,quantity:+Ze,lastPrice:T})}:void 0,onModify:w.closePosition||!Ge||!Xe?void 0:function(){Tt({type:"TV_amountclick"}),O({order:w,price:re.toString(),quantity:ie,lastPrice:T})},onCancel:function(){Tt({type:"TV_cancel"}),W(w)}}})},[G,K,T,te,_,O,W,s]),oe=(0,r.useMemo)(function(){return Y.map(function(N){var w=N.id,re=N.value,ie=N.text,le=N.onChange,de=N.isBuy,Be=N.type;return{id:w,price:+re,quantity:"",text:ie,isBuy:de,editable:!0,limitOrderType:c.aA.OrderPreview,onMove:function(ve){var Ce=ve.price;(0,xr.eP)({namespace:a,orderType:Be}),le({id:w,newPrice:Ce})},onMoving:function(ve){var Ce=ve.price;return le({id:w,newPrice:Ce})}}})},[Y,a]),Te=(0,r.useMemo)(function(){return(0,d._)(J).concat((0,d._)(oe))},[J,oe]);return{orderLines:Te}},Vt=e(17855),Bt=function(t,n){var a=(0,r.useState)(t()),u=a[0],s=a[1];return(0,Vt.A)(function(){return s(t())},n),u},Kt=e(58656),Ht=function(t){var n=t.symbol,a=(0,Kt.Q)({symbol:n})||[],u=Bt(function(){return a.map(function(s){var g=s.position,S=s.pnl,K=s.pnlInNumber,Y=s.pnlText,H=s.price,j=s.quantity,$=s.reverseText,f=s.isBuy,l=s.displayReverseOrderModal,T=s.displayClosePositionModal;return{id:g.id||"".concat(g.symbol,"-").concat(g.positionSide),PNL:K,text:"".concat(Y," ").concat(S),price:H,quantity:j,tooltip:"",reverseTooltip:$,isBuy:f,onReverse:l,onClose:function(){T(),(0,gt.u4)("$WebClick",{item:1,module:"xxx",$element_id:"kline_close_position"})}}})},[a]);return{positionLines:u}},jt=e(47354),bt=e.n(jt),$t=e(87017),Ut=e(99168),Yt=e(3742),Wt=e(43335),Gt=e(15540),zt=e(20163),Qt=e(47255);const Jt=t=>({endTime:n})=>(n??0)===t;var Zt=e(36488),Ct=e(48018),Xt=e(82911),We=e(69578),wt=e(53208),Rt=e(19862),qt=e(8874),en=e(26679),rn=e(66547),It=(function(){var t=(0,o._)(function(n){var a,u,s,g,S,K,Y,H,j;return(0,i._)(this,function($){switch($.label){case 0:a=n.onFetchKlineData,u=n.startTime,s=n.endTime,g=n.interval,S=n.limit,K=S===void 0?1e3:S,Y=[],H=[],j=s,$.label=1;case 1:return[4,a((0,cr._)({interval:g,limit:K},j===0?{}:{endTime:j}))];case 2:if(H=$.sent(),H.length===0)return[3,4];H.forEach(function(f){var l=(0,v._)(f,8),T=l[0],W=l[1],_=l[2],O=l[3],G=l[4],te=l[5],J=l[7];Y.push({time:+T,open:+W,high:+_,low:+O,close:+G,volume:+te,quantity:+J})}),j=H[0][0]-1,$.label=3;case 3:if(j>u)return[3,1];$.label=4;case 4:return Y.sort(function(f,l){return f.time-l.time}),[2,Y]}})});return function(a){return t.apply(this,arguments)}})(),tn=function(t){var n=t.firstDataRequest,a=t.hasRequested,u=t.rangeEndDate;return n&&!a?0:u*1e3},nn=e(78142),an=e(16238),St=e.n(an),on=e(98087),xt=e.n(on),sn=e(55009),cn=e.n(sn),kt=e(56477);const Et=t=>cn()(t.chartsCount(),n=>t.chart(n)),un=async t=>{try{const{schema:n,data:a}=await t.exportData({includedStudies:[]}),u=xt()(a)?.[n.findIndex(s=>s.type==="time")];return u!==void 0&&Number.isFinite(u)?u*1e3:void 0}catch{return}},ln=({getWidget:t,...n})=>{const a=new Map,u=new Map,s=()=>{try{const f=t();return f?St()(Et(f).map(l=>l.symbolExt()?.ticker)):[]}catch{return[]}},g=f=>{const l=s();return!l.length||l.includes(f)},S=f=>{const l=u.get(f);if(l)return l;const T={controller:new AbortController,claimedAsMain:!1};return u.set(f,T),T},K=f=>{const l=u.get(f);l&&(l.controller.abort(),u.delete(f))},Y=()=>{const f=s();f.length&&Array.from(u.keys()).forEach(l=>{const T=u.get(l);if(T){if(f.includes(l)){T.claimedAsMain=!0;return}a.has(l)||T.claimedAsMain&&K(l)}})},H=(f,l)=>{f.closed||l.time<f.highWater||(f.highWater=l.time,f.options.onTick(l),f.detector?.onBar(l),g(f.options.ticker)&&$.onBar(l))},j=async(f,l)=>{f.held=[];let T=l;try{const _=(await f.options.fetchSince(l)).filter(O=>O.time>=l&&!f.closed);_.forEach(O=>{f.highWater=Math.max(f.highWater,O.time),f.options.onTick(O)}),T=xt()(_)?.time??l}finally{const W=f.held??[];f.held=void 0,W.filter(_=>_.time>=T).forEach(_=>{H(f,_)})}},$=(0,kt.k)({...n,onCheck:Y,repair:async()=>{const f=t();if(f)try{const l=Et(f),T=St()(l.map(_=>{const O=a.get(_.symbolExt()?.ticker??"");return O&&{chart:_,feed:O}}));if(!T.length){f.resetCache(),l.forEach(_=>{_.resetData()});return}const W=St()(await Promise.all(T.map(async({chart:_,feed:O})=>{const G=await un(_);return G===void 0?void 0:{feed:O,fromMs:G}})));await Promise.allSettled(W.map(({feed:_,fromMs:O})=>j(_,O)))}catch{}}});return{openFeed:f=>{const l={options:f,held:void 0,highWater:0,closed:!1,detector:void 0};return l.detector=(0,kt.k)({...n,subscribeSignals:f.subscribeSignals,repair:async()=>{l.closed||!l.highWater||g(f.ticker)||await j(l,l.highWater)}}),a.set(f.ticker,l),g(f.ticker)&&$.resubscribeSignals(f.subscribeSignals),{push:T=>{l.held?l.held.push(T):H(l,T)},close:()=>{l.closed=!0,l.detector?.dispose(),a.get(f.ticker)===l&&a.delete(f.ticker)}}},subscribeWake:$.subscribeWake,getSignal:f=>{const l=S(f);return s().includes(f)&&(l.claimedAsMain=!0),l.controller.signal},dispose:()=>{u.forEach(({controller:f})=>{f.abort()}),u.clear(),a.forEach(f=>{f.detector?.dispose()}),a.clear(),$.dispose()}}};var dn=e(71730),vn=e(36620),fn=function(t){var n=t.namespace,a=k.y$(n),u=(0,vn.l)().getSocketSignals,s=(0,r.useRef)();(0,r.useEffect)(function(){return function(){var S;(S=s.current)===null||S===void 0||S.instance.dispose(),s.current=void 0}},[]);var g=(0,r.useCallback)(function(S){var K,Y,H=S;if(((K=s.current)===null||K===void 0?void 0:K.key)===H)return s.current.instance;(Y=s.current)===null||Y===void 0||Y.instance.dispose();var j=nn.wr(S),$=ln({getWidget:function(){return a.getState().tradingViewReference},checkPeriodMs:dn.D(j)});return s.current={key:H,instance:$},$},[a]);return(0,r.useMemo)(function(){return{ensureRecovery:g,getSocketSignals:u}},[g,u])},mn="tv_web_error",pn=[Ye.bt.TRADING,Ye.bt.DELIVERING],Re;(function(t){t.Futures="futures",t.FuturesMark="futures-mark",t.FuturesIndex="futures-index",t.Delivery="delivery",t.DeliveryMark="delivery-mark",t.DeliveryIndex="delivery-index"})(Re||(Re={}));var Mt=function(t){var n=t.symbol,a=t.description,u=t.productType,s=t.pricePrecision,g=t.params,S=t.supportedResolutions,K=S===void 0?F:S;return{symbol:n,description:a,tickSize:Math.pow(10,s),exchange:"Binance",supportedResolutions:K,type:u,params:g}},yn=function(t){var n=t.namespace,a=t.useMiniTicker,u=a===void 0?!1:a,s=t.isCM,g=c.y$(n),S=k.y$(n),K=(0,$t.useQueryClient)(),Y=fn({namespace:n}),H=Y.ensureRecovery,j=Y.getSocketSignals,$=(0,r.useRef)(0),f=(0,r.useRef)(!1),l=(0,r.useMemo)(function(){return bt()(function(){return(0,We.HP)({eventId:"trd_chart_tv_load_timeout",stepId:"getBarsStart",catch:function(Q){var ee=Q.error,ae=Q.track;ae({GET_BAR_START_TYPE:ee})},log:function(Q){var ee=Q.track;ee({GET_BAR_START_TYPE:"SUCCESS"})}})})},[]),T=(0,r.useMemo)(function(){return bt()(function(z){return(0,We.HP)({eventId:"trd_chart_tv_load_timeout",stepId:"getBarsEnd",catch:function(ee){var ae=ee.error,Se=ee.track;Se({GET_BAR_END_TYPE:ae,duration_:(0,We.Pu)(z-$.current)})},log:function(ee){var ae=ee.track;ae({GET_BAR_END_TYPE:"SUCCESS",duration_:(0,We.Pu)(z-$.current)})}})})},[]),W=(0,Nr.o)("trd-chart","trade-ui"),_=W.getI18n,O=(0,he.ud)(),G=O.getI18n,te=(0,v._)(g(c.Ir),1),J=te[0],oe=(0,v._)(S(k.A7),2),Te=oe[1],N=(0,se.Ye)(),w=(0,Zt.JD)(s).isContUnit,re=(0,se.y_)(),ie=(0,r.useRef)(N),le=(0,r.useRef)(J),de=(0,r.useRef)(re);(0,r.useEffect)(function(){ie.current=N},[N]),(0,r.useEffect)(function(){le.current=J},[J]),(0,r.useEffect)(function(){de.current=re},[re]);var Be=(0,r.useMemo)(function(){return w?Rt.b:Rt.S},[w]),ve=(0,r.useMemo)(function(){return G("usdtFutures-13",{defaultValue:"Futures"})||""},[G]),Ce=(0,r.useMemo)(function(){return G("inverseFutures-13",{defaultValue:"Delivery"})||""},[G]),ce=(0,r.useMemo)(function(){return _("indexPrice",{defaultValue:"Index Price"})||""},[_]),Ke=(0,r.useMemo)(function(){return _("markPrice",{defaultValue:"Mark Price"})||""},[_]),Ze=(0,r.useMemo)(function(){return _("lastPrice",{defaultValue:"Last Price"})||""},[_]),Ge=(0,r.useMemo)(function(){return{exchanges:[{name:"Binance",value:"Binance",desc:""}],symbols_types:[{name:ve,value:Re.Futures},{name:"".concat(ve," ").concat(Ke),value:Re.FuturesMark},{name:"".concat(ve," ").concat(ce),value:Re.FuturesIndex},{name:Ce,value:Re.Delivery},{name:"".concat(Ce," ").concat(Ke),value:Re.DeliveryMark},{name:"".concat(Ce," ").concat(ce),value:Re.DeliveryIndex}]}},[Ce,ve,ce,Ke]),Xe=(0,r.useCallback)((0,o._)(function(){var z,Q,ee;return(0,i._)(this,function(ae){switch(ae.label){case 0:return ae.trys.push([0,2,,3]),[4,(0,en.c)(K)];case 1:return ae.sent(),[3,3];case 2:return z=ae.sent(),(0,gt.u4)(mn,{type:"onFetchSymbolsInfo",message:z.message,business:"futures"}),[3,3];case 3:return Q=ie.current,ee=Object.keys(Q).reduce(function(Se,xe){var ne=Q[xe]||Ct.o,ke=ne.symbol,Me=ne.pricePrecision,fe=ne.isDelivery,Pe=ne.contractStatus;if(!pn.includes(Pe))return Se;var _e=(0,Yt.S)(ne,G),je=_e.symbol,Ee=_e.contractTypeI18n,me=_e.deliveryDateFormat,ye="".concat(je," ").concat(Ee).concat(me?" ".concat(me):""),$e="".concat(ye," ").concat(Ze),Oe="".concat(ye," ").concat(ce),lr="".concat(ye," ").concat(Ke);return Se.concat([Mt({symbol:ke,description:$e,productType:fe?Re.Delivery:Re.Futures,pricePrecision:Me,params:{priceType:c.SJ.Last}}),Mt({symbol:ke,description:Oe,productType:fe?Re.DeliveryIndex:Re.FuturesIndex,pricePrecision:Me,params:{priceType:c.SJ.Index}}),Mt({symbol:ke,description:lr,productType:fe?Re.DeliveryMark:Re.FuturesMark,pricePrecision:(0,Xt.X)(Me),params:{priceType:c.SJ.Mark}})])},[]),[2,ee]}})}),[G,ce,Ke,Ze,K]),Ie=(0,r.useCallback)(function(z){var Q=z.ticker,ee=z.symbol,ae=z.interval,Se=z.priceType,xe=z.retryUntil,ne=ie.current[ee]||Ct.o,ke=ne.pair,Me=ne.contractType,fe=ne.contractVal,Pe=ne.isDelivery,_e=Pe?Be(fe):function(Oe){return Oe},je=(0,wt.h)({symbol:ee,pair:ke,contractType:Me,isDelivery:Pe,priceType:Se}),Ee,me,ye=function(Oe){return zt.y("tv","".concat(Pe?"cm":"um","|").concat(ee,"|").concat(Se,"|").concat(Oe.interval,"|").concat((Ee=Oe.limit)!==null&&Ee!==void 0?Ee:"","|").concat((me=Oe.endTime)!==null&&me!==void 0?me:""))};if(xe===void 0)return{transform:_e,onFetchKlineData:je};var $e=H(ae);return{transform:_e,onFetchKlineData:Qt.b(je,{enabled:Jt(xe),key:ye,signal:$e.getSignal(Q),subscribeWake:$e.subscribeWake})}},[H,Be]),He=(0,r.useCallback)((function(){var z=(0,o._)(function(Q){var ee,ae,Se,xe,ne,ke,Me,fe,Pe,_e,je,Ee,me,ye,$e,Oe,lr,Or;return(0,i._)(this,function(dr){switch(dr.label){case 0:return ee=Q.binanceInterval,ae=Q.rangeStartDate,Se=Q.rangeEndDate,xe=Q.tickerInfo,ne=Q.symbolInfo,ke=Q.firstDataRequest,$.current=Date.now(),l(),Me=xe.symbol,fe=Me===void 0?"":Me,Pe=xe.params,_e=Pe.priceType,je=_e===void 0?le.current:_e,de.current({symbol:fe,priceType:je})?(T(Date.now()),[2,[]]):(Ee=Math.max(0,ae*1e3),me=tn({firstDataRequest:ke,hasRequested:f.current,rangeEndDate:Se}),f.current=!0,$e=Ie({ticker:(ye=ne.ticker)!==null&&ye!==void 0?ye:"",symbol:fe,interval:ee,priceType:je,retryUntil:ke?me:void 0}),Oe=$e.transform,lr=$e.onFetchKlineData,[4,It({onFetchKlineData:lr,startTime:Ee,endTime:me,interval:ee})]);case 1:return Or=dr.sent(),T(Date.now()),[2,Or.map(Oe)]}})});return function(Q){return z.apply(this,arguments)}})(),[Ie,T,l]),ur=(0,r.useCallback)(function(z){var Q=z.binanceInterval,ee=z.callback,ae=z.tickerInfo,Se=z.symbolInfo,xe=ae.symbol,ne=xe===void 0?"":xe,ke=ae.params,Me=ke.priceType,fe=Me===void 0?le.current:Me;if(de.current({symbol:ne,priceType:fe}))return function(){return null};var Pe=ie.current[ne]||Ct.o,_e=Pe.pair,je=Pe.contractType,Ee=Pe.isDelivery,me,ye=(me=Se.ticker)!==null&&me!==void 0?me:"",$e=Ie({ticker:ye,symbol:ne,interval:Q,priceType:fe}).transform,Oe=H(Q),lr=Oe.openFeed({ticker:ye,onTick:ee,subscribeSignals:j(Ee),fetchSince:(function(){var dr=(0,o._)(function(Lr){var Ur,Yr,ct,De;return(0,i._)(this,function(ze){switch(ze.label){case 0:return Ur=Ie({ticker:ye,symbol:ne,interval:Q,priceType:fe,retryUntil:0}),Yr=Ur.transform,ct=Ur.onFetchKlineData,[4,It({onFetchKlineData:ct,startTime:Lr,endTime:0,interval:Q})];case 1:return De=ze.sent(),[2,De.map(Yr)]}})});return function(Lr){return dr.apply(this,arguments)}})()}),Or=(0,rn.B)({symbol:ne,pair:_e,contractType:je,interval:Q,priceType:fe,isDelivery:Ee,useMiniTicker:u,callback:function(dr){lr.push($e(dr))}});return function(){lr.close(),Or()}},[Ie,H,j,u]),Tr=(0,r.useCallback)((0,o._)(function(){var z;return(0,i._)(this,function(Q){switch(Q.label){case 0:return[4,K.fetchQuery(Wt.Bz.SERVER_TIME(s),function(){return(0,Gt.l)(s)},{})];case 1:return z=Q.sent(),[2,Math.floor(z/1e3)]}})}),[K,s]),_r=(0,r.useCallback)(function(z){return(0,cr._)({},z.template,(0,qt.sp)(s))},[s]),Cr=(0,r.useMemo)(function(){return ue()},[]),Er=Cr({config:Ge,onFetchSymbolsInfo:Xe,onFetchBars:He,onSubscribeBars:ur,onFetchServerTimeApi:Tr,onTransformSymbolInfo:_r}),we=Er.datafeed,Dr=Er.symbolsInfo;return(0,Ut.A)(function(){return Te()},[w]),{datafeed:we,symbolsInfo:Dr}},Pt="trd_chart_tv_load_timeout",hn=function(){var t=(0,We.PM)({id:"chartReady"}),n=(0,We.PM)({id:"getBarsStart",timeout:3}),a=(0,We.PM)({id:"getBarsEnd",timeout:6}),u=(0,We.PM)({id:"chartResponsive",timeout:3});We.HP.init({step:t._(n)._(a)._(u),eventId:Pt}),(0,We.HP)({eventId:Pt,stepId:"chartReady",catch:function(g){var S=g.error,K=g.track;K({CHART_READY_TYPE:S,connection:JSON.stringify(navigator.connection)})},log:function(g){var S=g.track;S({CHART_READY_TYPE:"SUCCESS",connection:JSON.stringify(navigator.connection)})}})},gn=function(t){(0,We.HP)({eventId:Pt,stepId:"chartResponsive",catch:function(a){var u=a.error,s=a.track;s({CHART_RESPONSIVE_TYPE:u,connection:JSON.stringify(navigator.connection)})},log:function(a){var u=a.track;u({CHART_RESPONSIVE_TYPE:"SUCCESS",duration_:(0,We.Pu)(Date.now()-t)})}})},Tn=[Qe.ZE,Qe.F3],Dt=function(t){var n=t.symbol,a=t.namespace,u=t.useMiniTicker,s=u===void 0?!1:u,g=c.y$(a),S=k.y$(a),K=(0,v._)(g(c.A8),1),Y=K[0],H=(0,v._)(g(c.Ir),2),j=H[0],$=H[1],f=(0,v._)(S(k.yj),1),l=f[0],T=(0,v._)(g(c.e6),1),W=T[0],_=(0,v._)(g(c._b),1),O=_[0],G=(0,he.ot)(),te=(0,pr.K7)(),J=te.pathname.includes(Ae.Q2),oe=te.pathname.includes(Ae.eq),Te=(0,r.useMemo)(function(){return J?(0,d._)(B.oT).concat(["hide_left_toolbar_by_default"]):B.oT},[J]),N=(0,se.Ye)(),w=(0,se.v3)({symbol:n}),re=(0,Fe.es)(n),ie=yn({namespace:a,useMiniTicker:s,isCM:re}),le=ie.datafeed,de=ie.symbolsInfo,Be=(0,Je.DP)(),ve=Be.theme,Ce=ve==="light"||ve==="light_glacier"?"light":"dark",ce=(0,yr.Z)(Ce),Ke=(0,r.useRef)(-1),Ze=Ht({symbol:n}).positionLines,Ge=Nt({symbol:n,namespace:a}).orderLines,Xe=ir({symbol:n}).executionOrders,Ie=pt({namespace:a,symbol:n}),He=(0,se.y0)(),ur=(0,r.useRef)(He),Tr=(0,r.useRef)(N),_r=(0,r.useRef)(l),Cr=(0,r.useRef)(J),Er=(0,r.useRef)(oe),we=(0,r.useRef)(de);(0,r.useEffect)(function(){we.current=de},[de]),(0,r.useEffect)(function(){ur.current=He},[He]),(0,r.useEffect)(function(){Tr.current=N},[N]),(0,r.useEffect)(function(){_r.current=l},[l]),(0,r.useEffect)(function(){Cr.current=J},[J]),(0,r.useEffect)(function(){Er.current=oe},[oe]),(0,Ve.a)(n,s),(0,sr.A)({symbol:n,interval:Y,priceType:j});var Dr=(0,r.useCallback)(function(){Ke.current=Date.now()},[]),z=(0,r.useCallback)((0,o._)(function(){var De,ze,qe,be,vr,fr,er;return(0,i._)(this,function(nr){switch(nr.label){case 0:if(Cr.current||!_r.current)return[2,Promise.resolve()];nr.label=1;case 1:return nr.trys.push([1,5,,6]),De=h().createInstance({name:a}),[4,De.keys()];case 2:return ze=nr.sent(),qe=ze.filter(function(mr){return/^((#TV_SYMBOL-)|(myTradingView))/g.test(mr)}),be=qe.map((function(){var mr=(0,o._)(function(ar){return(0,i._)(this,function(Sr){return[2,De.getItem(ar)]})});return function(ar){return mr.apply(this,arguments)}})()),[4,Promise.all(be)];case 3:return vr=nr.sent(),fr=U()(qe,vr),[4,Promise.all(Tn.map((function(){var mr=(0,o._)(function(ar){var Sr,Wr;return(0,i._)(this,function(Gr){switch(Gr.label){case 0:return a===ar?[2,Promise.resolve()]:(Sr=h().createInstance({name:ar}),Wr=fr.map((function(){var Sn=(0,o._)(function(Lt){var _t,Ot,At;return(0,i._)(this,function(Mn){return _t=(0,v._)(Lt,2),Ot=_t[0],At=_t[1],Ot?[2,Sr.setItem(Ot,At)]:[2,Promise.resolve()]})});return function(Lt){return Sn.apply(this,arguments)}})()),[4,Promise.all(Wr)]);case 1:return Gr.sent(),[2,Promise.resolve()]}})});return function(ar){return mr.apply(this,arguments)}})()))];case 4:return nr.sent(),[2,Promise.resolve()];case 5:return er=nr.sent(),console.warn(typeof er=="string"?er:er.message),[2,Promise.resolve()];case 6:return[2]}})}),[a]),Q=(0,r.useMemo)(function(){return z},[z]),ee=(0,or.R)(),ae=(0,Ne.fQ)(a),Se=(0,Ne.m3)(a),xe=(0,Ne.S_)(a),ne=(0,Ne.Ds)(a),ke=(0,r.useRef)(n),Me=(0,r.useRef)(Y),fe=(0,r.useCallback)(function(){return ee("tradingView"),xe({panel_index:0,symbol:n,interval:Y}),hn()},[Y,ee,n,xe]),Pe=(0,r.useCallback)(function(De){var ze=De.index,qe=De.chart,be,vr,fr,er=(fr=(vr=(be=qe.symbolExt())===null||be===void 0?void 0:be.name)!==null&&vr!==void 0?vr:qe.symbol())!==null&&fr!==void 0?fr:"";ae({panel_index:ze,symbol:er,previous_symbol:ke.current}),ke.current=er},[ae]),_e=(0,r.useCallback)(function(De){var ze=De.index,qe=De.chart,be=qe.resolution();Se({panel_index:ze,interval:be,previous_interval:Me.current}),Me.current=be},[Se]),je=(0,r.useCallback)(function(){gn(Ke.current)},[]),Ee=(0,r.useCallback)(function(){},[]),me=(0,r.useMemo)(function(){return J?Ee:void 0},[Ee,J]),ye=(0,r.useCallback)((function(){var De=(0,o._)(function(ze){var qe,be,vr,fr,er,nr,mr,ar,Sr;return(0,i._)(this,function(Wr){switch(Wr.label){case 0:return qe=ze.chart,be=qe.symbolExt(),be?(vr=b()(we.current,function(Gr){return Gr.ticker===be.ticker||Gr.symbol===be.ticker}),fr=vr||{},er=fr.params,nr=er===void 0?{}:er,mr=nr.priceType,ar=mr===void 0?"":mr,ar&&$(ar),Sr=Tr.current[be.name],Sr?Er.current||Cr.current?[2]:[4,z()]:[2]):[2];case 1:return Wr.sent(),G({stateSymbol:Sr.symbol,isDeliveryColumn:Sr.isDelivery}),[2]}})});return function(ze){return De.apply(this,arguments)}})(),[G,z,$]),$e=qr(),Oe=$e.onCrosshairMoved,lr=$e.crosshairPrice,Or=wr({namespace:a,symbol:n,priceType:j,crosshairPrice:lr}),dr=lt(),Lr=(0,r.useMemo)(function(){return L({symbol:n,params:{priceType:j}})},[n,j]),Ur=(0,r.useMemo)(function(){return{symbol:Lr,theme:ce,limitOrders:Ge,positionOrders:Ze,executionOrders:Xe,labelLines:Ie,initialConfig:{tvConfig:{symbol:Lr,library_path:"/".concat(Ye.u_,"/trading-platform-30/"),theme:ce,datafeed:le,enabled_features:Te,context_menu:Or,custom_formatters:dr},onCrosshairMoved:Oe,onScriptLoaded:Dr,onSave:Q,onChartReadyDone:fe,onFirstTimeDataLoadedDone:je,onInitChart:me,onActiveChartChanged:ye,onSymbolChanged:Pe,onIntervalChanged:_e}}},[Lr,le,Te,Xe,Ie,Or,dr,Oe,ye,fe,je,me,_e,Q,Dr,Pe,Ge,Ze,ce]),Yr=Le({namespace:a,type:"tv"}),ct=(0,r.useCallback)(function(){ne({panel_index:0,symbol:n}),Yr()},[Yr,n,ne]);return(0,p.jsxs)(D.t,{name:"trading_view",onReset:ct,children:[(0,p.jsx)(Ue.A,{namespace:a,tradingViewProps:Ur}),w&&j==="index"&&O===c.Ev.Single&&W===c.tU.TradingView&&(0,p.jsx)(rr.B,{})]})};const Cn=Dt}';
  function createMirrorFactory(__dispatchChartMirror) {
    if (typeof __dispatchChartMirror !== "function") throw new Error("Mirror dispatch must be a function");
    return { 70940(Z, x, e) {
      "use strict";
      e.r(x), e.d(x, { TradingView: () => Dt, default: () => Cn });
      var o = e(49253), v = e(77135), d = e(75510), i = e(42288), p = e(31085), r = e(41594), M = e(43917), h = e.n(M), P = e(81936), b = e.n(P), V = e(7980), U = e.n(V), D = e(76469), c = e(4260), k = e(53837), B = e(27571), C = e(45250), y = e(87646), A = e.n(y), q = e(80817);
      const E = (0, C.range)(1, 1380), m = (0, C.range)(1, 365).map((t) => `${t}D`), R = (0, C.range)(1, 52).map((t) => `${t}W`), I = (0, C.range)(1, 12).map((t) => `${t}M`), F = ["1S", ...E, ...m, ...R, ...I], L = ({ symbol: t, params: n }) => {
        const a = new URLSearchParams(n);
        return `${t}@${a.toString()}`;
      }, X = (t) => {
        const [n, a] = t.split("@"), s = new URLSearchParams(a).entries(), g = A()(Array.from(s));
        return { symbol: n, params: g };
      }, ue = () => {
        const t = /* @__PURE__ */ new Map();
        let n = {}, a = [], u = { onReady: () => null, resolveSymbol: () => null, searchSymbols: () => null, getBars: () => null, subscribeBars: () => null, unsubscribeBars: () => null };
        return ({ config: s, onSymbolResolving: g, onSymbolResolved: S, onFetchSymbolsInfo: K, onFetchBars: Y, onSubscribeBars: H, onUnsubscribeBars: j, onFetchServerTimeApi: $, onTransformSymbolInfo: f = ({ template: T }) => T, onSearchSymbols: l = () => true }) => (u = { onReady: (T) => {
          setTimeout(async () => {
            const _ = (await K()).map((O) => ({ ...O, ticker: L({ symbol: O.symbol, params: O.params || {} }) }));
            a = _.map(({ ticker: O, symbol: G, description: te = "", exchange: J = "", type: oe = "" }) => ({ symbol: G, ticker: O, description: te, exchange: J, type: oe })), n = (0, C.keyBy)(_, "ticker"), T({ exchanges: [], symbols_types: [], supported_resolutions: F, supports_marks: false, supports_timescale_marks: false, supports_time: true, ...s });
          });
        }, resolveSymbol: async (T, W, _) => {
          const O = n[T];
          if (!O) {
            _(`cannot resolve symbol - ${T}`);
            return;
          }
          const G = f({ info: O, template: { description: O.description || "", fractional: false, has_seconds: true, seconds_multipliers: ["1"], has_intraday: true, intraday_multipliers: ["1", "3", "5", "15", "30", "60", "120", "240", "360", "480", "720"], has_daily: true, daily_multipliers: ["1"], has_weekly_and_monthly: true, weekly_multipliers: ["1"], monthly_multipliers: ["1"], minmov: 1, minmove2: 0, name: O.symbol, ticker: O.ticker, timezone: "Etc/UTC", pricescale: O.tickSize, session: "24x7", type: O.type || "", exchange: O.exchange || "", listed_exchange: O.exchange || "", format: "price", supported_resolutions: F, visible_plots_set: "ohlcv", volume_precision: 3 } });
          if (g) {
            const te = X(G.ticker || "");
            if (!await g({ symbol: T, info: G, tickerInfo: te })) {
              _(`symbol resolving error - ${T}`);
              return;
            }
          }
          setTimeout(() => {
            W(G), S?.(G);
          });
        }, searchSymbols: (T, W, _, O) => {
          const G = new RegExp(T, "i"), te = new RegExp(W, "i"), J = new RegExp(_, "i"), oe = a.filter((Te) => {
            const { symbol: N, ticker: w, description: re = "", exchange: ie = "", type: le = "" } = Te;
            return [N, w, re].some((de) => G.test(de || "")) && te.test(ie) && J.test(le) && l?.({ item: Te });
          });
          O(oe);
        }, getBars: async (T, W, _, O, G) => {
          const { from: te, to: J, firstDataRequest: oe } = _, Te = (0, q.Cz)(W);
          try {
            if (J >= 0) {
              const N = X(T.ticker || ""), w = await Y({ symbolInfo: T, resolution: W, rangeStartDate: te, rangeEndDate: J, tickerInfo: N, binanceInterval: Te, firstDataRequest: oe });
              O(w, { noData: w.length === 0 });
            } else O([], { noData: true });
          } catch (N) {
            G(N.toString());
          }
        }, subscribeBars: (T, W, _, O, G) => {
          const te = X(T.ticker || ""), J = (0, q.Cz)(W), oe = H({ symbolInfo: T, resolution: W, callback: _, onResetCacheNeededCallback: G, tickerInfo: te, binanceInterval: J });
          t.set(O, oe);
        }, unsubscribeBars: (T) => {
          t?.get(T)?.(), t?.delete(T), j?.(T);
        }, getServerTime: async (T) => {
          try {
            const W = await $();
            T(W);
          } catch (W) {
            console.warn(W), T(Date.now() / 1e3);
          }
        } }, { datafeed: u, observers: t, symbolsInfo: n });
      }, Le = ({ namespace: t, type: n }) => {
        const a = (0, r.useMemo)(() => h().createInstance({ name: t }), [t]);
        return (0, r.useCallback)(() => {
          n === "tv" && a.removeItem("myTradingView");
        }, [a, n]);
      };
      var Ue = e(76535), pr = e(26531), Ye = e(17409), Qe = e(94652), Ae = e(76830), he = e(48651), Fe = e(79344), se = e(51029), Je = e(36307), or = e(25379), yr = e(44745), Ne = e(15727), rr = e(45358), sr = e(82071), Ve = e(85411), ge = e(94889), hr = e(94547), tr = e(80686), Ar = e(61875);
      function Fr(t) {
        return (0, ge._)(t) || (0, hr._)(t) || (0, Ar._)(t) || (0, tr._)();
      }
      var Nr = e(92873), zr = e(35630), Vr = e(12055), Qr = e(79515), Br = e(80737), Jr = e(40545), Zr = e(98107), Kr = e(51846), Xr = "Chart.Crosshair.PlusButton.DrawHorizontalLine", wr = function(t) {
        var n = t.namespace, a = t.symbol, u = t.priceType, s = t.crosshairPrice, g = (0, Nr.o)("", "kline-ui").getI18n, S = (0, Vr.r)().format, K = k.y$(n), Y = (0, Br.S)({ namespace: n }), H = (0, Jr.hw)(), j = (0, Zr.c)(), $ = (0, Qr.nH)(), f = (0, se.Ye)(), l = (0, Kr.E)({ symbol: a }), T = (0, Fe.f0)(a), W = T.isCM, _ = (0, r.useRef)(s);
        (0, r.useEffect)(function() {
          _.current = s;
        }, [s]);
        var O = (0, r.useRef)(H);
        (0, r.useEffect)(function() {
          O.current = H;
        }, [H]);
        var G = (0, r.useRef)(j);
        (0, r.useEffect)(function() {
          G.current = j;
        }, [j]);
        var te = (0, r.useRef)(u);
        (0, r.useEffect)(function() {
          te.current = u;
        }, [u]);
        var J = (0, r.useRef)($);
        (0, r.useEffect)(function() {
          J.current = $;
        }, [$]);
        var oe = (0, r.useRef)(f);
        (0, r.useEffect)(function() {
          oe.current = f;
        }, [f]);
        var Te = (0, r.useRef)(l);
        (0, r.useEffect)(function() {
          Te.current = l;
        }, [l]);
        var N = (0, r.useRef)(W);
        return (0, r.useEffect)(function() {
          N.current = W;
        }, [W]), { items_processor: (function() {
          var w = (0, o._)(function(re, ie, le) {
            var de, Be, ve, Ce, ce, Ke, Ze, Ge, Xe, Ie, He, ur, Tr, _r, Cr;
            return (0, i._)(this, function(Er) {
              if (Be = K.getState().tradingViewReference, !Be) return console.warn("[context-menu] trading view reference is not found"), [2, re];
              if (Be.chartsCount() > 1) return [2, re];
              if (ve = Be.activeChart().symbolExt(), !ve) return [2, re];
              switch (Ce = ve.name, ce = _.current, Ke = le.menuName === "CrosshairMenuView" ? "chart-trading" : "context-menu", Ze = { price: "".concat(ce.value), formattedPrice: ce.formatted, source: Ke, chartType: "tradingview" }, Ge = (de = oe.current[Ce]) === null || de === void 0 ? void 0 : de.baseAsset, Xe = g("trade", { defaultValue: "Trade" }), Ie = S(ce.formatted), He = G.current && te.current === c.SJ.Last && J.current && Ge ? [ie.createAction({ actionId: "Chart.PlaceOrder.BuyLimit", label: "".concat(Xe, " ").concat(Ge, " @ ").concat(Ie, " ").concat(g("limit", { defaultValue: "Limit" })), onExecute: function() {
                return Te.current.onClickBuyLimit(Ze);
              } }), ie.createAction({ actionId: "Chart.PlaceOrder.BuyStop", label: "".concat(Xe, " ").concat(Ge, " @ ").concat(Ie, " ").concat(g("stop", { defaultValue: "Stop" })), onExecute: function() {
                return Te.current.onClickBuyStop(Ze);
              } })] : [], ur = O.current ? ie.createAction({ actionId: "Chart.PriceAlert.CreateAtCrosshair", label: g("create-alert-at", { defaultValue: "Create Alert at {{price}}", price: ce.formatted }), onExecute: function() {
                Y({ symbol: Ce, price: ce.formatted, mode: zr.n.CREATE });
              } }) : null, re.forEach(function(we) {
                if (!(!("execute" in we) || !("getState" in we))) {
                  var Dr = we.getState();
                  if (Dr.actionId === Xr) {
                    var z = we.execute.bind(we);
                    we.execute = function() {
                      (0, Kr.A)({ elementId: "draw_horizontal_line", isDelivery: N.current, chartType: "tradingview" }), z();
                    };
                  }
                }
              }), le.menuName) {
                case "CrosshairMenuView":
                  return ur ? [2, [ur].concat((0, d._)(He), (0, d._)(re.slice()))] : [2, (0, d._)(He).concat((0, d._)(re.slice()))];
                case "ChartContextMenu":
                  return ur ? (Tr = Fr(re), _r = Tr[0], Cr = Tr.slice(1), [2, [_r, ur].concat((0, d._)(He), (0, d._)(Cr))]) : [2, (0, d._)(He).concat((0, d._)(re.slice()))];
                default:
                  return [2, re];
              }
              return [2];
            });
          });
          return function(re, ie, le) {
            return w.apply(this, arguments);
          };
        })() };
      }, qr = function() {
        var t = (0, r.useState)({ value: NaN, formatted: "" }), n = t[0], a = t[1], u = (0, r.useCallback)(function(s) {
          var g = s.crosshairData, S = s.activeChart;
          S && a({ value: g.price, formatted: S.priceFormatter().format(g.price) });
        }, []);
        return { onCrosshairMoved: u, crosshairPrice: n };
      };
      const Hr = (t) => Math.floor(Math.log10(t)), et = (t) => {
        const [n = "1"] = t.split(",");
        return Hr(+n);
      }, pe = ({ symbolInfo: t, minTick: n }) => {
        const { pricescale: a = 2 } = t || {};
        return n === "default" || n === void 0 ? Hr(a) : et(n);
      }, br = (t) => (n, a) => {
        try {
          return n ? { format: (u) => {
            const s = pe({ symbolInfo: n, minTick: a });
            return t.format({ symbolInfo: n, minTick: a, value: u, precision: s });
          } } : null;
        } catch {
          return null;
        }
      }, Mr = 10 ** 12, rt = 10 ** 9, tt = 10 ** 6, jr = 10 ** 3, gr = (t) => {
        const n = t.toString(), [, a = ""] = n.split(".");
        return Math.min(a.length, 3);
      }, nt = ({ value: t }) => {
        const n = Math.abs(t);
        if (n >= Mr) {
          const a = t / Mr;
          return { value: a, unit: "T", precision: gr(a) };
        }
        if (n >= rt) {
          const a = t / rt;
          return { value: a, unit: "B", precision: gr(a) };
        }
        if (n >= tt) {
          const a = t / tt;
          return { value: a, unit: "M", precision: gr(a) };
        }
        if (n >= jr) {
          const a = t / jr;
          return { value: a, unit: "K", precision: gr(a) };
        }
        return { value: t, unit: "", precision: gr(t) };
      }, ut = (t) => (n, a, u) => {
        try {
          return a && n.type === "volume" ? { format: (s) => s === void 0 ? "" : t.formatVolume({ format: n, symbolInfo: a, precision: u, value: s, volumeDetail: nt({ value: s }) }) } : null;
        } catch {
          return null;
        }
      };
      var lt = function() {
        var t = (0, Vr.r)(), n = t.format, a = (0, r.useMemo)(function() {
          return br({ format: function(s) {
            var g = s.value, S = s.precision;
            return n(g, { precision: S });
          } });
        }, [n]), u = (0, r.useMemo)(function() {
          return ut({ formatVolume: function(s) {
            var g = s.value, S = s.volumeDetail;
            if (g === void 0 || !S) return "";
            var K = n(S.value, { precision: S.precision });
            return "".concat(K).concat(S.unit);
          } });
        }, [n]);
        return { priceFormatterFactory: a, studyFormatterFactory: u };
      }, dt = e(74069), ir = function(t) {
        var n = (0, dt.K)(t), a = (0, r.useMemo)(function() {
          return n.map(function(u) {
            var s = u.id, g = u.time, S = u.isBuy, K = u.price, Y = u.tooltip;
            return { id: s, text: "", price: K, quantity: "", time: Math.round(g / 1e3), isBuy: S, tooltip: Y };
          });
        }, [n]);
        return { executionOrders: a };
      }, at = function(t) {
        var n = t.namespace, a = t.symbol, u = (0, Br.j)({ namespace: n, symbol: a });
        return (0, r.useMemo)(function() {
          return u.map(function(s) {
            var g = s.id, S = s.price, K = s.formattedPrice, Y = s.sideText, H = s.showCloseButton, j = s.isPriceChangeable, $ = s.cancelTooltipText, f = s.onClick, l = s.onCancel, T = s.onPriceChanged;
            return { id: g, price: +S, text: "".concat(Y, " ").concat(K), editable: j, cancellable: H, cancelTooltip: $, type: c.ND.PriceAlert, onCancel: H ? l : void 0, onMove: j ? function(W) {
              var _ = W.price;
              T({ currentPrice: _ });
            } : void 0, onClick: f };
          });
        }, [u]);
      }, vt = e(90664), ot = function(t) {
        var n = t.symbol, a = (0, vt.w)({ symbol: n });
        return (0, r.useMemo)(function() {
          return a.map(function(u) {
            var s = u.id, g = u.text, S = u.price;
            return { id: s, text: g, price: +S, type: c.ND.BreakEvenPrice };
          });
        }, [a]);
      }, cr = e(82508), ft = e(91025), mt = e(36077), Rr = function(t) {
        var n = t.symbol, a = (0, mt.c)({ symbol: n });
        return (0, r.useMemo)(function() {
          return a.map(function(u) {
            return (0, ft._)((0, cr._)({}, u), { type: c.ND.LiquidationPrice });
          });
        }, [a]);
      }, pt = function(t) {
        var n = t.namespace, a = t.symbol, u = at({ namespace: n, symbol: a }), s = ot({ symbol: a }), g = Rr({ symbol: a });
        return (0, r.useMemo)(function() {
          return (0, d._)(u).concat((0, d._)(s), (0, d._)(g));
        }, [u, s, g]);
      }, st = e(42902), Ir = e(90170), yt = e(63345), ht = e(48210), Pr = e(51289), xr = e(24326), $r = e(90922), kr = e(34235), it = e(63762), Ft = function(t) {
        var n = (0, Fe.f0)(t), a = n.pricePrecision, u = n.isCM, s = (0, st.yD)(t) || {}, g = s.lastPrice, S = g === void 0 ? "0" : g, K = (0, kr.Bp)(u), Y = (0, it.HY)(t), H = (0, kr.gv)(u), j = (0, kr.WF)(u);
        return (0, r.useMemo)(function() {
          return (0, $r.qF)({ orders: (0, d._)(K).concat((0, d._)(H), (0, d._)(j)), symbol: t }).map(function($) {
            return Y({ order: $, lastPrice: S, pricePrecision: a });
          });
        }, [S, K, H, a, t, Y]);
      }, gt = e(31542), Tt = function(t) {
        var n = t.type;
        (0, gt.u4)("webClick", { module: "chart", elementId: n });
      }, Nt = function(t) {
        var n = t.symbol, a = t.namespace, u = (0, r.useState)(0), s = u[0], g = u[1], S = (0, r.useCallback)(function() {
          return g(function(N) {
            return N + 1;
          });
        }, []), K = Ft(n), Y = (0, xr.IT)({ namespace: a }), H = (0, Fe.f0)(n), j = H.isDelivery, $ = H.contractType, f = (0, st.yD)(n) || {}, l = f.lastPrice, T = l === void 0 ? "0" : l, W = (0, yt.s)(n), _ = (0, it.YZ)({ symbol: n, afterConfirmationModalIsShown: S }), O = (0, it.u8)(n), G = (0, it.jn)(n), te = (0, r.useCallback)(function(N) {
          return (0, ht.D)({ order: N, isDelivery: j, symbol: j ? N.symbol : "".concat(N.symbol, "_").concat($), module: "tradingview_kline" });
        }, [$, j]), J = (0, r.useMemo)(function() {
          return K.map(function(N) {
            var w = N.order, re = N.price, ie = N.quantity, le = N.quantityText, de = N.isBuy, Be = N.text, ve = N.priceTooltipText, Ce = N.pnlText, ce = (0, Pr.$L)(w), Ke = (0, Pr.OX)(w), Ze = (0, Pr.xL)(w), Ge = ce === "LIMIT", Xe = (0, Ir.Y)(w);
            return { id: String(Ke), text: Be, price: +re, quantity: le, isBuy: de, editable: Xe && G, tooltip: ve, modifyTooltip: w.closePosition || !Ge ? "" : void 0, onMove: G ? function(Ie) {
              var He = Ie.price;
              te(w), Tt({ type: "TV_vertical" }), _({ order: w, price: +He, quantity: +Ze, lastPrice: T });
            } : void 0, onModify: w.closePosition || !Ge || !Xe ? void 0 : function() {
              Tt({ type: "TV_amountclick" }), O({ order: w, price: re.toString(), quantity: ie, lastPrice: T });
            }, onCancel: function() {
              Tt({ type: "TV_cancel" }), W(w);
            } };
          });
        }, [G, K, T, te, _, O, W, s]), oe = (0, r.useMemo)(function() {
          return Y.map(function(N) {
            var w = N.id, re = N.value, ie = N.text, le = N.onChange, de = N.isBuy, Be = N.type;
            return { id: w, price: +re, quantity: "", text: ie, isBuy: de, editable: true, limitOrderType: c.aA.OrderPreview, onMove: function(ve) {
              var Ce = ve.price;
              (0, xr.eP)({ namespace: a, orderType: Be }), le({ id: w, newPrice: Ce });
            }, onMoving: function(ve) {
              var Ce = ve.price;
              return le({ id: w, newPrice: Ce });
            } };
          });
        }, [Y, a]), Te = (0, r.useMemo)(function() {
          return (0, d._)(J).concat((0, d._)(oe));
        }, [J, oe]);
        return { orderLines: Te };
      }, Vt = e(17855), Bt = function(t, n) {
        var a = (0, r.useState)(t()), u = a[0], s = a[1];
        return (0, Vt.A)(function() {
          return s(t());
        }, n), u;
      }, Kt = e(58656), Ht = function(t) {
        var n = t.symbol, a = (0, Kt.Q)({ symbol: n }) || [], u = Bt(function() {
          return a.map(function(s) {
            var g = s.position, S = s.pnl, K = s.pnlInNumber, Y = s.pnlText, H = s.price, j = s.quantity, $ = s.reverseText, f = s.isBuy, l = s.displayReverseOrderModal, T = s.displayClosePositionModal;
            return { id: g.id || "".concat(g.symbol, "-").concat(g.positionSide), PNL: K, text: "".concat(Y, " ").concat(S), price: H, quantity: j, tooltip: "", reverseTooltip: $, isBuy: f, onReverse: l, onClose: function() {
              T(), (0, gt.u4)("$WebClick", { item: 1, module: "xxx", $element_id: "kline_close_position" });
            } };
          });
        }, [a]);
        return { positionLines: u };
      }, jt = e(47354), bt = e.n(jt), $t = e(87017), Ut = e(99168), Yt = e(3742), Wt = e(43335), Gt = e(15540), zt = e(20163), Qt = e(47255);
      const Jt = (t) => ({ endTime: n }) => (n ?? 0) === t;
      var Zt = e(36488), Ct = e(48018), Xt = e(82911), We = e(69578), wt = e(53208), Rt = e(19862), qt = e(8874), en = e(26679), rn = e(66547), It = (function() {
        var t = (0, o._)(function(n) {
          var a, u, s, g, S, K, Y, H, j;
          return (0, i._)(this, function($) {
            switch ($.label) {
              case 0:
                a = n.onFetchKlineData, u = n.startTime, s = n.endTime, g = n.interval, S = n.limit, K = S === void 0 ? 1e3 : S, Y = [], H = [], j = s, $.label = 1;
              case 1:
                return [4, a((0, cr._)({ interval: g, limit: K }, j === 0 ? {} : { endTime: j }))];
              case 2:
                if (H = $.sent(), H.length === 0) return [3, 4];
                H.forEach(function(f) {
                  var l = (0, v._)(f, 8), T = l[0], W = l[1], _ = l[2], O = l[3], G = l[4], te = l[5], J = l[7];
                  Y.push({ time: +T, open: +W, high: +_, low: +O, close: +G, volume: +te, quantity: +J });
                }), j = H[0][0] - 1, $.label = 3;
              case 3:
                if (j > u) return [3, 1];
                $.label = 4;
              case 4:
                return Y.sort(function(f, l) {
                  return f.time - l.time;
                }), [2, Y];
            }
          });
        });
        return function(a) {
          return t.apply(this, arguments);
        };
      })(), tn = function(t) {
        var n = t.firstDataRequest, a = t.hasRequested, u = t.rangeEndDate;
        return n && !a ? 0 : u * 1e3;
      }, nn = e(78142), an = e(16238), St = e.n(an), on = e(98087), xt = e.n(on), sn = e(55009), cn = e.n(sn), kt = e(56477);
      const Et = (t) => cn()(t.chartsCount(), (n) => t.chart(n)), un = async (t) => {
        try {
          const { schema: n, data: a } = await t.exportData({ includedStudies: [] }), u = xt()(a)?.[n.findIndex((s) => s.type === "time")];
          return u !== void 0 && Number.isFinite(u) ? u * 1e3 : void 0;
        } catch {
          return;
        }
      }, ln = ({ getWidget: t, ...n }) => {
        const a = /* @__PURE__ */ new Map(), u = /* @__PURE__ */ new Map(), s = () => {
          try {
            const f = t();
            return f ? St()(Et(f).map((l) => l.symbolExt()?.ticker)) : [];
          } catch {
            return [];
          }
        }, g = (f) => {
          const l = s();
          return !l.length || l.includes(f);
        }, S = (f) => {
          const l = u.get(f);
          if (l) return l;
          const T = { controller: new AbortController(), claimedAsMain: false };
          return u.set(f, T), T;
        }, K = (f) => {
          const l = u.get(f);
          l && (l.controller.abort(), u.delete(f));
        }, Y = () => {
          const f = s();
          f.length && Array.from(u.keys()).forEach((l) => {
            const T = u.get(l);
            if (T) {
              if (f.includes(l)) {
                T.claimedAsMain = true;
                return;
              }
              a.has(l) || T.claimedAsMain && K(l);
            }
          });
        }, H = (f, l) => {
          f.closed || l.time < f.highWater || (f.highWater = l.time, f.options.onTick(l), f.detector?.onBar(l), g(f.options.ticker) && $.onBar(l));
        }, j = async (f, l) => {
          f.held = [];
          let T = l;
          try {
            const _ = (await f.options.fetchSince(l)).filter((O) => O.time >= l && !f.closed);
            _.forEach((O) => {
              f.highWater = Math.max(f.highWater, O.time), f.options.onTick(O);
            }), T = xt()(_)?.time ?? l;
          } finally {
            const W = f.held ?? [];
            f.held = void 0, W.filter((_) => _.time >= T).forEach((_) => {
              H(f, _);
            });
          }
        }, $ = (0, kt.k)({ ...n, onCheck: Y, repair: async () => {
          const f = t();
          if (f) try {
            const l = Et(f), T = St()(l.map((_) => {
              const O = a.get(_.symbolExt()?.ticker ?? "");
              return O && { chart: _, feed: O };
            }));
            if (!T.length) {
              f.resetCache(), l.forEach((_) => {
                _.resetData();
              });
              return;
            }
            const W = St()(await Promise.all(T.map(async ({ chart: _, feed: O }) => {
              const G = await un(_);
              return G === void 0 ? void 0 : { feed: O, fromMs: G };
            })));
            await Promise.allSettled(W.map(({ feed: _, fromMs: O }) => j(_, O)));
          } catch {
          }
        } });
        return { openFeed: (f) => {
          const l = { options: f, held: void 0, highWater: 0, closed: false, detector: void 0 };
          return l.detector = (0, kt.k)({ ...n, subscribeSignals: f.subscribeSignals, repair: async () => {
            l.closed || !l.highWater || g(f.ticker) || await j(l, l.highWater);
          } }), a.set(f.ticker, l), g(f.ticker) && $.resubscribeSignals(f.subscribeSignals), { push: (T) => {
            l.held ? l.held.push(T) : H(l, T);
          }, close: () => {
            l.closed = true, l.detector?.dispose(), a.get(f.ticker) === l && a.delete(f.ticker);
          } };
        }, subscribeWake: $.subscribeWake, getSignal: (f) => {
          const l = S(f);
          return s().includes(f) && (l.claimedAsMain = true), l.controller.signal;
        }, dispose: () => {
          u.forEach(({ controller: f }) => {
            f.abort();
          }), u.clear(), a.forEach((f) => {
            f.detector?.dispose();
          }), a.clear(), $.dispose();
        } };
      };
      var dn = e(71730), vn = e(36620), fn = function(t) {
        var n = t.namespace, a = k.y$(n), u = (0, vn.l)().getSocketSignals, s = (0, r.useRef)();
        (0, r.useEffect)(function() {
          return function() {
            var S;
            (S = s.current) === null || S === void 0 || S.instance.dispose(), s.current = void 0;
          };
        }, []);
        var g = (0, r.useCallback)(function(S) {
          var K, Y, H = S;
          if (((K = s.current) === null || K === void 0 ? void 0 : K.key) === H) return s.current.instance;
          (Y = s.current) === null || Y === void 0 || Y.instance.dispose();
          var j = nn.wr(S), $ = ln({ getWidget: function() {
            return a.getState().tradingViewReference;
          }, checkPeriodMs: dn.D(j) });
          return s.current = { key: H, instance: $ }, $;
        }, [a]);
        return (0, r.useMemo)(function() {
          return { ensureRecovery: g, getSocketSignals: u };
        }, [g, u]);
      }, mn = "tv_web_error", pn = [Ye.bt.TRADING, Ye.bt.DELIVERING], Re;
      (function(t) {
        t.Futures = "futures", t.FuturesMark = "futures-mark", t.FuturesIndex = "futures-index", t.Delivery = "delivery", t.DeliveryMark = "delivery-mark", t.DeliveryIndex = "delivery-index";
      })(Re || (Re = {}));
      var Mt = function(t) {
        var n = t.symbol, a = t.description, u = t.productType, s = t.pricePrecision, g = t.params, S = t.supportedResolutions, K = S === void 0 ? F : S;
        return { symbol: n, description: a, tickSize: Math.pow(10, s), exchange: "Binance", supportedResolutions: K, type: u, params: g };
      }, yn = function(t) {
        var n = t.namespace, a = t.useMiniTicker, u = a === void 0 ? false : a, s = t.isCM, g = c.y$(n), S = k.y$(n), K = (0, $t.useQueryClient)(), Y = fn({ namespace: n }), H = Y.ensureRecovery, j = Y.getSocketSignals, $ = (0, r.useRef)(0), f = (0, r.useRef)(false), l = (0, r.useMemo)(function() {
          return bt()(function() {
            return (0, We.HP)({ eventId: "trd_chart_tv_load_timeout", stepId: "getBarsStart", catch: function(Q) {
              var ee = Q.error, ae = Q.track;
              ae({ GET_BAR_START_TYPE: ee });
            }, log: function(Q) {
              var ee = Q.track;
              ee({ GET_BAR_START_TYPE: "SUCCESS" });
            } });
          });
        }, []), T = (0, r.useMemo)(function() {
          return bt()(function(z) {
            return (0, We.HP)({ eventId: "trd_chart_tv_load_timeout", stepId: "getBarsEnd", catch: function(ee) {
              var ae = ee.error, Se = ee.track;
              Se({ GET_BAR_END_TYPE: ae, duration_: (0, We.Pu)(z - $.current) });
            }, log: function(ee) {
              var ae = ee.track;
              ae({ GET_BAR_END_TYPE: "SUCCESS", duration_: (0, We.Pu)(z - $.current) });
            } });
          });
        }, []), W = (0, Nr.o)("trd-chart", "trade-ui"), _ = W.getI18n, O = (0, he.ud)(), G = O.getI18n, te = (0, v._)(g(c.Ir), 1), J = te[0], oe = (0, v._)(S(k.A7), 2), Te = oe[1], N = (0, se.Ye)(), w = (0, Zt.JD)(s).isContUnit, re = (0, se.y_)(), ie = (0, r.useRef)(N), le = (0, r.useRef)(J), de = (0, r.useRef)(re);
        (0, r.useEffect)(function() {
          ie.current = N;
        }, [N]), (0, r.useEffect)(function() {
          le.current = J;
        }, [J]), (0, r.useEffect)(function() {
          de.current = re;
        }, [re]);
        var Be = (0, r.useMemo)(function() {
          return w ? Rt.b : Rt.S;
        }, [w]), ve = (0, r.useMemo)(function() {
          return G("usdtFutures-13", { defaultValue: "Futures" }) || "";
        }, [G]), Ce = (0, r.useMemo)(function() {
          return G("inverseFutures-13", { defaultValue: "Delivery" }) || "";
        }, [G]), ce = (0, r.useMemo)(function() {
          return _("indexPrice", { defaultValue: "Index Price" }) || "";
        }, [_]), Ke = (0, r.useMemo)(function() {
          return _("markPrice", { defaultValue: "Mark Price" }) || "";
        }, [_]), Ze = (0, r.useMemo)(function() {
          return _("lastPrice", { defaultValue: "Last Price" }) || "";
        }, [_]), Ge = (0, r.useMemo)(function() {
          return { exchanges: [{ name: "Binance", value: "Binance", desc: "" }], symbols_types: [{ name: ve, value: Re.Futures }, { name: "".concat(ve, " ").concat(Ke), value: Re.FuturesMark }, { name: "".concat(ve, " ").concat(ce), value: Re.FuturesIndex }, { name: Ce, value: Re.Delivery }, { name: "".concat(Ce, " ").concat(Ke), value: Re.DeliveryMark }, { name: "".concat(Ce, " ").concat(ce), value: Re.DeliveryIndex }] };
        }, [Ce, ve, ce, Ke]), Xe = (0, r.useCallback)((0, o._)(function() {
          var z, Q, ee;
          return (0, i._)(this, function(ae) {
            switch (ae.label) {
              case 0:
                return ae.trys.push([0, 2, , 3]), [4, (0, en.c)(K)];
              case 1:
                return ae.sent(), [3, 3];
              case 2:
                return z = ae.sent(), (0, gt.u4)(mn, { type: "onFetchSymbolsInfo", message: z.message, business: "futures" }), [3, 3];
              case 3:
                return Q = ie.current, ee = Object.keys(Q).reduce(function(Se, xe) {
                  var ne = Q[xe] || Ct.o, ke = ne.symbol, Me = ne.pricePrecision, fe = ne.isDelivery, Pe = ne.contractStatus;
                  if (!pn.includes(Pe)) return Se;
                  var _e = (0, Yt.S)(ne, G), je = _e.symbol, Ee = _e.contractTypeI18n, me = _e.deliveryDateFormat, ye = "".concat(je, " ").concat(Ee).concat(me ? " ".concat(me) : ""), $e = "".concat(ye, " ").concat(Ze), Oe = "".concat(ye, " ").concat(ce), lr = "".concat(ye, " ").concat(Ke);
                  return Se.concat([Mt({ symbol: ke, description: $e, productType: fe ? Re.Delivery : Re.Futures, pricePrecision: Me, params: { priceType: c.SJ.Last } }), Mt({ symbol: ke, description: Oe, productType: fe ? Re.DeliveryIndex : Re.FuturesIndex, pricePrecision: Me, params: { priceType: c.SJ.Index } }), Mt({ symbol: ke, description: lr, productType: fe ? Re.DeliveryMark : Re.FuturesMark, pricePrecision: (0, Xt.X)(Me), params: { priceType: c.SJ.Mark } })]);
                }, []), [2, ee];
            }
          });
        }), [G, ce, Ke, Ze, K]), Ie = (0, r.useCallback)(function(z) {
          var Q = z.ticker, ee = z.symbol, ae = z.interval, Se = z.priceType, xe = z.retryUntil, ne = ie.current[ee] || Ct.o, ke = ne.pair, Me = ne.contractType, fe = ne.contractVal, Pe = ne.isDelivery, _e = Pe ? Be(fe) : function(Oe) {
            return Oe;
          }, je = (0, wt.h)({ symbol: ee, pair: ke, contractType: Me, isDelivery: Pe, priceType: Se }), Ee, me, ye = function(Oe) {
            return zt.y("tv", "".concat(Pe ? "cm" : "um", "|").concat(ee, "|").concat(Se, "|").concat(Oe.interval, "|").concat((Ee = Oe.limit) !== null && Ee !== void 0 ? Ee : "", "|").concat((me = Oe.endTime) !== null && me !== void 0 ? me : ""));
          };
          if (xe === void 0) return { transform: _e, onFetchKlineData: je };
          var $e = H(ae);
          return { transform: _e, onFetchKlineData: Qt.b(je, { enabled: Jt(xe), key: ye, signal: $e.getSignal(Q), subscribeWake: $e.subscribeWake }) };
        }, [H, Be]), He = (0, r.useCallback)((function() {
          var z = (0, o._)(function(Q) {
            var ee, ae, Se, xe, ne, ke, Me, fe, Pe, _e, je, Ee, me, ye, $e, Oe, lr, Or;
            return (0, i._)(this, function(dr) {
              switch (dr.label) {
                case 0:
                  return ee = Q.binanceInterval, ae = Q.rangeStartDate, Se = Q.rangeEndDate, xe = Q.tickerInfo, ne = Q.symbolInfo, ke = Q.firstDataRequest, $.current = Date.now(), l(), Me = xe.symbol, fe = Me === void 0 ? "" : Me, Pe = xe.params, _e = Pe.priceType, je = _e === void 0 ? le.current : _e, de.current({ symbol: fe, priceType: je }) ? (T(Date.now()), [2, []]) : (Ee = Math.max(0, ae * 1e3), me = tn({ firstDataRequest: ke, hasRequested: f.current, rangeEndDate: Se }), f.current = true, $e = Ie({ ticker: (ye = ne.ticker) !== null && ye !== void 0 ? ye : "", symbol: fe, interval: ee, priceType: je, retryUntil: ke ? me : void 0 }), Oe = $e.transform, lr = $e.onFetchKlineData, [4, It({ onFetchKlineData: lr, startTime: Ee, endTime: me, interval: ee })]);
                case 1:
                  return Or = dr.sent(), T(Date.now()), [2, Or.map(Oe)];
              }
            });
          });
          return function(Q) {
            return z.apply(this, arguments);
          };
        })(), [Ie, T, l]), ur = (0, r.useCallback)(function(z) {
          var Q = z.binanceInterval, ee = z.callback, ae = z.tickerInfo, Se = z.symbolInfo, xe = ae.symbol, ne = xe === void 0 ? "" : xe, ke = ae.params, Me = ke.priceType, fe = Me === void 0 ? le.current : Me;
          if (de.current({ symbol: ne, priceType: fe })) return function() {
            return null;
          };
          var Pe = ie.current[ne] || Ct.o, _e = Pe.pair, je = Pe.contractType, Ee = Pe.isDelivery, me, ye = (me = Se.ticker) !== null && me !== void 0 ? me : "", $e = Ie({ ticker: ye, symbol: ne, interval: Q, priceType: fe }).transform, Oe = H(Q), lr = Oe.openFeed({ ticker: ye, onTick: ee, subscribeSignals: j(Ee), fetchSince: (function() {
            var dr = (0, o._)(function(Lr) {
              var Ur, Yr, ct, De;
              return (0, i._)(this, function(ze) {
                switch (ze.label) {
                  case 0:
                    return Ur = Ie({ ticker: ye, symbol: ne, interval: Q, priceType: fe, retryUntil: 0 }), Yr = Ur.transform, ct = Ur.onFetchKlineData, [4, It({ onFetchKlineData: ct, startTime: Lr, endTime: 0, interval: Q })];
                  case 1:
                    return De = ze.sent(), [2, De.map(Yr)];
                }
              });
            });
            return function(Lr) {
              return dr.apply(this, arguments);
            };
          })() }), Or = (0, rn.B)({ symbol: ne, pair: _e, contractType: je, interval: Q, priceType: fe, isDelivery: Ee, useMiniTicker: u, callback: function(dr) {
            lr.push($e(dr));
          } });
          return function() {
            lr.close(), Or();
          };
        }, [Ie, H, j, u]), Tr = (0, r.useCallback)((0, o._)(function() {
          var z;
          return (0, i._)(this, function(Q) {
            switch (Q.label) {
              case 0:
                return [4, K.fetchQuery(Wt.Bz.SERVER_TIME(s), function() {
                  return (0, Gt.l)(s);
                }, {})];
              case 1:
                return z = Q.sent(), [2, Math.floor(z / 1e3)];
            }
          });
        }), [K, s]), _r = (0, r.useCallback)(function(z) {
          return (0, cr._)({}, z.template, (0, qt.sp)(s));
        }, [s]), Cr = (0, r.useMemo)(function() {
          return ue();
        }, []), Er = Cr({ config: Ge, onFetchSymbolsInfo: Xe, onFetchBars: He, onSubscribeBars: ur, onFetchServerTimeApi: Tr, onTransformSymbolInfo: _r }), we = Er.datafeed, Dr = Er.symbolsInfo;
        return (0, Ut.A)(function() {
          return Te();
        }, [w]), { datafeed: we, symbolsInfo: Dr };
      }, Pt = "trd_chart_tv_load_timeout", hn = function() {
        var t = (0, We.PM)({ id: "chartReady" }), n = (0, We.PM)({ id: "getBarsStart", timeout: 3 }), a = (0, We.PM)({ id: "getBarsEnd", timeout: 6 }), u = (0, We.PM)({ id: "chartResponsive", timeout: 3 });
        We.HP.init({ step: t._(n)._(a)._(u), eventId: Pt }), (0, We.HP)({ eventId: Pt, stepId: "chartReady", catch: function(g) {
          var S = g.error, K = g.track;
          K({ CHART_READY_TYPE: S, connection: JSON.stringify(navigator.connection) });
        }, log: function(g) {
          var S = g.track;
          S({ CHART_READY_TYPE: "SUCCESS", connection: JSON.stringify(navigator.connection) });
        } });
      }, gn = function(t) {
        (0, We.HP)({ eventId: Pt, stepId: "chartResponsive", catch: function(a) {
          var u = a.error, s = a.track;
          s({ CHART_RESPONSIVE_TYPE: u, connection: JSON.stringify(navigator.connection) });
        }, log: function(a) {
          var u = a.track;
          u({ CHART_RESPONSIVE_TYPE: "SUCCESS", duration_: (0, We.Pu)(Date.now() - t) });
        } });
      }, Tn = [Qe.ZE, Qe.F3], Dt = function(t) {
        var n = t.symbol, a = t.namespace, u = t.useMiniTicker, s = u === void 0 ? false : u, g = c.y$(a), S = k.y$(a), K = (0, v._)(g(c.A8), 1), Y = K[0], H = (0, v._)(g(c.Ir), 2), j = H[0], $ = H[1], f = (0, v._)(S(k.yj), 1), l = f[0], T = (0, v._)(g(c.e6), 1), W = T[0], _ = (0, v._)(g(c._b), 1), O = _[0], G = (0, he.ot)(), te = (0, pr.K7)(), J = te.pathname.includes(Ae.Q2), oe = te.pathname.includes(Ae.eq), Te = (0, r.useMemo)(function() {
          return J ? (0, d._)(B.oT).concat(["hide_left_toolbar_by_default"]) : B.oT;
        }, [J]), N = (0, se.Ye)(), w = (0, se.v3)({ symbol: n }), re = (0, Fe.es)(n), ie = yn({ namespace: a, useMiniTicker: s, isCM: re }), le = ie.datafeed, de = ie.symbolsInfo, Be = (0, Je.DP)(), ve = Be.theme, Ce = ve === "light" || ve === "light_glacier" ? "light" : "dark", ce = (0, yr.Z)(Ce), Ke = (0, r.useRef)(-1), Ze = Ht({ symbol: n }).positionLines, Ge = Nt({ symbol: n, namespace: a }).orderLines, Xe = ir({ symbol: n }).executionOrders, Ie = pt({ namespace: a, symbol: n }), He = (0, se.y0)(), ur = (0, r.useRef)(He), Tr = (0, r.useRef)(N), _r = (0, r.useRef)(l), Cr = (0, r.useRef)(J), Er = (0, r.useRef)(oe), we = (0, r.useRef)(de);
        (0, r.useEffect)(function() {
          we.current = de;
        }, [de]), (0, r.useEffect)(function() {
          ur.current = He;
        }, [He]), (0, r.useEffect)(function() {
          Tr.current = N;
        }, [N]), (0, r.useEffect)(function() {
          _r.current = l;
        }, [l]), (0, r.useEffect)(function() {
          Cr.current = J;
        }, [J]), (0, r.useEffect)(function() {
          Er.current = oe;
        }, [oe]), (0, Ve.a)(n, s), (0, sr.A)({ symbol: n, interval: Y, priceType: j });
        var Dr = (0, r.useCallback)(function() {
          Ke.current = Date.now();
        }, []), z = (0, r.useCallback)((0, o._)(function() {
          var De, ze, qe, be, vr, fr, er;
          return (0, i._)(this, function(nr) {
            switch (nr.label) {
              case 0:
                if (Cr.current || !_r.current) return [2, Promise.resolve()];
                nr.label = 1;
              case 1:
                return nr.trys.push([1, 5, , 6]), De = h().createInstance({ name: a }), [4, De.keys()];
              case 2:
                return ze = nr.sent(), qe = ze.filter(function(mr) {
                  return /^((#TV_SYMBOL-)|(myTradingView))/g.test(mr);
                }), be = qe.map((function() {
                  var mr = (0, o._)(function(ar) {
                    return (0, i._)(this, function(Sr) {
                      return [2, De.getItem(ar)];
                    });
                  });
                  return function(ar) {
                    return mr.apply(this, arguments);
                  };
                })()), [4, Promise.all(be)];
              case 3:
                return vr = nr.sent(), fr = U()(qe, vr), [4, Promise.all(Tn.map((function() {
                  var mr = (0, o._)(function(ar) {
                    var Sr, Wr;
                    return (0, i._)(this, function(Gr) {
                      switch (Gr.label) {
                        case 0:
                          return a === ar ? [2, Promise.resolve()] : (Sr = h().createInstance({ name: ar }), Wr = __dispatchChartMirror(Sr, fr, () => fr.map((function() {
                            var Sn = (0, o._)(function(Lt) {
                              var _t, Ot, At;
                              return (0, i._)(this, function(Mn) {
                                return _t = (0, v._)(Lt, 2), Ot = _t[0], At = _t[1], Ot ? [2, Sr.setItem(Ot, At)] : [2, Promise.resolve()];
                              });
                            });
                            return function(Lt) {
                              return Sn.apply(this, arguments);
                            };
                          })())), [4, Promise.all(Wr)]);
                        case 1:
                          return Gr.sent(), [2, Promise.resolve()];
                      }
                    });
                  });
                  return function(ar) {
                    return mr.apply(this, arguments);
                  };
                })()))];
              case 4:
                return nr.sent(), [2, Promise.resolve()];
              case 5:
                return er = nr.sent(), console.warn(typeof er == "string" ? er : er.message), [2, Promise.resolve()];
              case 6:
                return [2];
            }
          });
        }), [a]), Q = (0, r.useMemo)(function() {
          return z;
        }, [z]), ee = (0, or.R)(), ae = (0, Ne.fQ)(a), Se = (0, Ne.m3)(a), xe = (0, Ne.S_)(a), ne = (0, Ne.Ds)(a), ke = (0, r.useRef)(n), Me = (0, r.useRef)(Y), fe = (0, r.useCallback)(function() {
          return ee("tradingView"), xe({ panel_index: 0, symbol: n, interval: Y }), hn();
        }, [Y, ee, n, xe]), Pe = (0, r.useCallback)(function(De) {
          var ze = De.index, qe = De.chart, be, vr, fr, er = (fr = (vr = (be = qe.symbolExt()) === null || be === void 0 ? void 0 : be.name) !== null && vr !== void 0 ? vr : qe.symbol()) !== null && fr !== void 0 ? fr : "";
          ae({ panel_index: ze, symbol: er, previous_symbol: ke.current }), ke.current = er;
        }, [ae]), _e = (0, r.useCallback)(function(De) {
          var ze = De.index, qe = De.chart, be = qe.resolution();
          Se({ panel_index: ze, interval: be, previous_interval: Me.current }), Me.current = be;
        }, [Se]), je = (0, r.useCallback)(function() {
          gn(Ke.current);
        }, []), Ee = (0, r.useCallback)(function() {
        }, []), me = (0, r.useMemo)(function() {
          return J ? Ee : void 0;
        }, [Ee, J]), ye = (0, r.useCallback)((function() {
          var De = (0, o._)(function(ze) {
            var qe, be, vr, fr, er, nr, mr, ar, Sr;
            return (0, i._)(this, function(Wr) {
              switch (Wr.label) {
                case 0:
                  return qe = ze.chart, be = qe.symbolExt(), be ? (vr = b()(we.current, function(Gr) {
                    return Gr.ticker === be.ticker || Gr.symbol === be.ticker;
                  }), fr = vr || {}, er = fr.params, nr = er === void 0 ? {} : er, mr = nr.priceType, ar = mr === void 0 ? "" : mr, ar && $(ar), Sr = Tr.current[be.name], Sr ? Er.current || Cr.current ? [2] : [4, z()] : [2]) : [2];
                case 1:
                  return Wr.sent(), G({ stateSymbol: Sr.symbol, isDeliveryColumn: Sr.isDelivery }), [2];
              }
            });
          });
          return function(ze) {
            return De.apply(this, arguments);
          };
        })(), [G, z, $]), $e = qr(), Oe = $e.onCrosshairMoved, lr = $e.crosshairPrice, Or = wr({ namespace: a, symbol: n, priceType: j, crosshairPrice: lr }), dr = lt(), Lr = (0, r.useMemo)(function() {
          return L({ symbol: n, params: { priceType: j } });
        }, [n, j]), Ur = (0, r.useMemo)(function() {
          return { symbol: Lr, theme: ce, limitOrders: Ge, positionOrders: Ze, executionOrders: Xe, labelLines: Ie, initialConfig: { tvConfig: { symbol: Lr, library_path: "/".concat(Ye.u_, "/trading-platform-30/"), theme: ce, datafeed: le, enabled_features: Te, context_menu: Or, custom_formatters: dr }, onCrosshairMoved: Oe, onScriptLoaded: Dr, onSave: Q, onChartReadyDone: fe, onFirstTimeDataLoadedDone: je, onInitChart: me, onActiveChartChanged: ye, onSymbolChanged: Pe, onIntervalChanged: _e } };
        }, [Lr, le, Te, Xe, Ie, Or, dr, Oe, ye, fe, je, me, _e, Q, Dr, Pe, Ge, Ze, ce]), Yr = Le({ namespace: a, type: "tv" }), ct = (0, r.useCallback)(function() {
          ne({ panel_index: 0, symbol: n }), Yr();
        }, [Yr, n, ne]);
        return (0, p.jsxs)(D.t, { name: "trading_view", onReset: ct, children: [(0, p.jsx)(Ue.A, { namespace: a, tradingViewProps: Ur }), w && j === "index" && O === c.Ev.Single && W === c.tU.TradingView && (0, p.jsx)(rr.B, {})] });
      };
      const Cn = Dt;
    } }[70940];
  }
  function replaceChartMirrorFactory(originalFactory, dispatch) {
    if (typeof originalFactory !== "function" || Function.prototype.toString.call(originalFactory) !== originalFactorySource) {
      throw new Error("Mirror factory source does not match the pinned public module");
    }
    return createMirrorFactory(dispatch);
  }

  // experiments/binance-chart-storage/native-preflight-core.js
  var INCIDENT_URL = "https://www.binance.com/zh-CN/futures/USUSDT";
  var OBSERVATION_MS = 3e4;
  function isIncidentPage() {
    return location.href === INCIDENT_URL && self === top;
  }
  function startNativeMirrorPreflight() {
    const state = {
      active: true,
      outcome: "waiting",
      stopReason: null,
      failure: null,
      attempts: 0,
      matches: 0,
      executions: 0,
      completed: false,
      dispatches: 0,
      entryCount: 0
    };
    let observer;
    let timer;
    function snapshot() {
      return { ...state, failure: state.failure === null ? null : { ...state.failure } };
    }
    function retire(reason) {
      if (!state.active) return snapshot();
      state.active = false;
      state.stopReason = reason;
      clearTimeout(timer);
      self.removeEventListener("pagehide", onPageHide);
      if (observer) observer.stop();
      return snapshot();
    }
    function fail(code) {
      state.failure = { name: "PreflightError", code };
      state.outcome = "failed";
      retire("failure");
    }
    function onPageHide() {
      retire("pagehide");
    }
    function dispatch(_target, entries, nativeThunk) {
      if (state.active) {
        if (!isIncidentPage()) retire("scope_changed");
        else {
          try {
            const count = entries.length;
            if (state.active) {
              state.dispatches += 1;
              state.entryCount += count;
            }
          } catch {
            fail("entry_count_unavailable");
          }
        }
      }
      return nativeThunk();
    }
    const session = Object.freeze({ snapshot, stop: () => retire("manual"), dispatch });
    if (!isIncidentPage()) {
      fail("unsupported_page");
      return session;
    }
    try {
      observer = observeChartStorageBootstrap({
        replaceMirrorFactory(original) {
          if (!isIncidentPage()) {
            retire("scope_changed");
            return original;
          }
          state.attempts += 1;
          let factory;
          try {
            factory = replaceChartMirrorFactory(original, dispatch);
          } catch {
            fail("source_mismatch");
            return original;
          }
          state.matches += 1;
          return function(...args) {
            if (state.active) {
              if (!isIncidentPage()) retire("scope_changed");
              else state.executions += 1;
            }
            try {
              return Reflect.apply(factory, this, args);
            } catch (error) {
              if (state.active) fail("module_execution_failed");
              throw error;
            }
          };
        },
        onCapture() {
          if (!state.active) return;
          if (!isIncidentPage()) retire("scope_changed");
          else {
            state.completed = true;
            state.outcome = "captured";
          }
        }
      });
    } catch {
      fail("bootstrap_rejected");
      return session;
    }
    observer.captured.catch(() => {
      if (state.active) fail("observation_failed");
    });
    self.addEventListener("pagehide", onPageHide, { once: true });
    timer = setTimeout(() => retire("deadline"), OBSERVATION_MS);
    return session;
  }

  // experiments/binance-chart-storage/native-preflight-entry.user.js
  (function installNativeMirrorPreflight() {
    if (Object.hasOwn(self, "__BINANCE_MIRROR_PREFLIGHT__")) return;
    const { snapshot, stop } = startNativeMirrorPreflight();
    Object.defineProperty(self, "__BINANCE_MIRROR_PREFLIGHT__", {
      value: Object.freeze({ snapshot, stop }),
      configurable: true
    });
  })();
})();
