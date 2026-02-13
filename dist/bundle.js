const t={};function e(){try{return"localStorage"in window&&null!==window.localStorage}catch(t){return!1}}function s(t,e){let s=e;for(;s<t.length;){const e=t[s];if(""!=e&&" "!=e[0]&&"\t"!=e[0]&&"\n"!=e[0])break;s++}return s}function i(t,e){let s,i=-1,n=-1;const r=t.split("\n");for(var o=r.length-1;o>=0;o--){let t=r[o];if(t.startsWith("SyntaxError")||t.startsWith("IndentationError"))n=o;else if(t.includes('File "<exec>", line')){s=parseInt(t.split(", line ")[1],10),s-=e-1,i=o;break}}return-1==i||-1==n?"No error report found.":`Error at line ${s}:\n`+r.slice(i+1,n+1).join("\n")}
/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const n=window.ShadowRoot&&(void 0===window.ShadyCSS||window.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,r=Symbol(),o=new WeakMap;class l{constructor(t,e,s){if(this._$cssResult$=!0,s!==r)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=e}get styleSheet(){let t=this.o;const e=this.t;if(n&&void 0===t){const s=void 0!==e&&1===e.length;s&&(t=o.get(e)),void 0===t&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),s&&o.set(e,t))}return t}toString(){return this.cssText}}const a=(t,...e)=>{const s=1===t.length?t[0]:e.reduce(((e,s,i)=>e+(t=>{if(!0===t._$cssResult$)return t.cssText;if("number"==typeof t)return t;throw Error("Value passed to 'css' function must be a 'css' function result: "+t+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(s)+t[i+1]),t[0]);return new l(s,t,r)},d=n?t=>t:t=>t instanceof CSSStyleSheet?(t=>{let e="";for(const s of t.cssRules)e+=s.cssText;return(t=>new l("string"==typeof t?t:t+"",void 0,r))(e)})(t):t
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */;var h;const c=window.trustedTypes,u=c?c.emptyScript:"",p=window.reactiveElementPolyfillSupport,v={toAttribute(t,e){switch(e){case Boolean:t=t?u:null;break;case Object:case Array:t=null==t?t:JSON.stringify(t)}return t},fromAttribute(t,e){let s=t;switch(e){case Boolean:s=null!==t;break;case Number:s=null===t?null:Number(t);break;case Object:case Array:try{s=JSON.parse(t)}catch(t){s=null}}return s}},$=(t,e)=>e!==t&&(e==e||t==t),f={attribute:!0,type:String,converter:v,reflect:!1,hasChanged:$};class _ extends HTMLElement{constructor(){super(),this._$Ei=new Map,this.isUpdatePending=!1,this.hasUpdated=!1,this._$El=null,this.u()}static addInitializer(t){var e;null!==(e=this.h)&&void 0!==e||(this.h=[]),this.h.push(t)}static get observedAttributes(){this.finalize();const t=[];return this.elementProperties.forEach(((e,s)=>{const i=this._$Ep(s,e);void 0!==i&&(this._$Ev.set(i,s),t.push(i))})),t}static createProperty(t,e=f){if(e.state&&(e.attribute=!1),this.finalize(),this.elementProperties.set(t,e),!e.noAccessor&&!this.prototype.hasOwnProperty(t)){const s="symbol"==typeof t?Symbol():"__"+t,i=this.getPropertyDescriptor(t,s,e);void 0!==i&&Object.defineProperty(this.prototype,t,i)}}static getPropertyDescriptor(t,e,s){return{get(){return this[e]},set(i){const n=this[t];this[e]=i,this.requestUpdate(t,n,s)},configurable:!0,enumerable:!0}}static getPropertyOptions(t){return this.elementProperties.get(t)||f}static finalize(){if(this.hasOwnProperty("finalized"))return!1;this.finalized=!0;const t=Object.getPrototypeOf(this);if(t.finalize(),this.elementProperties=new Map(t.elementProperties),this._$Ev=new Map,this.hasOwnProperty("properties")){const t=this.properties,e=[...Object.getOwnPropertyNames(t),...Object.getOwnPropertySymbols(t)];for(const s of e)this.createProperty(s,t[s])}return this.elementStyles=this.finalizeStyles(this.styles),!0}static finalizeStyles(t){const e=[];if(Array.isArray(t)){const s=new Set(t.flat(1/0).reverse());for(const t of s)e.unshift(d(t))}else void 0!==t&&e.push(d(t));return e}static _$Ep(t,e){const s=e.attribute;return!1===s?void 0:"string"==typeof s?s:"string"==typeof t?t.toLowerCase():void 0}u(){var t;this._$E_=new Promise((t=>this.enableUpdating=t)),this._$AL=new Map,this._$Eg(),this.requestUpdate(),null===(t=this.constructor.h)||void 0===t||t.forEach((t=>t(this)))}addController(t){var e,s;(null!==(e=this._$ES)&&void 0!==e?e:this._$ES=[]).push(t),void 0!==this.renderRoot&&this.isConnected&&(null===(s=t.hostConnected)||void 0===s||s.call(t))}removeController(t){var e;null===(e=this._$ES)||void 0===e||e.splice(this._$ES.indexOf(t)>>>0,1)}_$Eg(){this.constructor.elementProperties.forEach(((t,e)=>{this.hasOwnProperty(e)&&(this._$Ei.set(e,this[e]),delete this[e])}))}createRenderRoot(){var t;const e=null!==(t=this.shadowRoot)&&void 0!==t?t:this.attachShadow(this.constructor.shadowRootOptions);return((t,e)=>{n?t.adoptedStyleSheets=e.map((t=>t instanceof CSSStyleSheet?t:t.styleSheet)):e.forEach((e=>{const s=document.createElement("style"),i=window.litNonce;void 0!==i&&s.setAttribute("nonce",i),s.textContent=e.cssText,t.appendChild(s)}))})(e,this.constructor.elementStyles),e}connectedCallback(){var t;void 0===this.renderRoot&&(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),null===(t=this._$ES)||void 0===t||t.forEach((t=>{var e;return null===(e=t.hostConnected)||void 0===e?void 0:e.call(t)}))}enableUpdating(t){}disconnectedCallback(){var t;null===(t=this._$ES)||void 0===t||t.forEach((t=>{var e;return null===(e=t.hostDisconnected)||void 0===e?void 0:e.call(t)}))}attributeChangedCallback(t,e,s){this._$AK(t,s)}_$EO(t,e,s=f){var i,n;const r=this.constructor._$Ep(t,s);if(void 0!==r&&!0===s.reflect){const o=(null!==(n=null===(i=s.converter)||void 0===i?void 0:i.toAttribute)&&void 0!==n?n:v.toAttribute)(e,s.type);this._$El=t,null==o?this.removeAttribute(r):this.setAttribute(r,o),this._$El=null}}_$AK(t,e){var s,i;const n=this.constructor,r=n._$Ev.get(t);if(void 0!==r&&this._$El!==r){const t=n.getPropertyOptions(r),o=t.converter,l=null!==(i=null!==(s=null==o?void 0:o.fromAttribute)&&void 0!==s?s:"function"==typeof o?o:null)&&void 0!==i?i:v.fromAttribute;this._$El=r,this[r]=l(e,t.type),this._$El=null}}requestUpdate(t,e,s){let i=!0;void 0!==t&&(((s=s||this.constructor.getPropertyOptions(t)).hasChanged||$)(this[t],e)?(this._$AL.has(t)||this._$AL.set(t,e),!0===s.reflect&&this._$El!==t&&(void 0===this._$EC&&(this._$EC=new Map),this._$EC.set(t,s))):i=!1),!this.isUpdatePending&&i&&(this._$E_=this._$Ej())}async _$Ej(){this.isUpdatePending=!0;try{await this._$E_}catch(t){Promise.reject(t)}const t=this.scheduleUpdate();return null!=t&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){var t;if(!this.isUpdatePending)return;this.hasUpdated,this._$Ei&&(this._$Ei.forEach(((t,e)=>this[e]=t)),this._$Ei=void 0);let e=!1;const s=this._$AL;try{e=this.shouldUpdate(s),e?(this.willUpdate(s),null===(t=this._$ES)||void 0===t||t.forEach((t=>{var e;return null===(e=t.hostUpdate)||void 0===e?void 0:e.call(t)})),this.update(s)):this._$Ek()}catch(t){throw e=!1,this._$Ek(),t}e&&this._$AE(s)}willUpdate(t){}_$AE(t){var e;null===(e=this._$ES)||void 0===e||e.forEach((t=>{var e;return null===(e=t.hostUpdated)||void 0===e?void 0:e.call(t)})),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(t)),this.updated(t)}_$Ek(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$E_}shouldUpdate(t){return!0}update(t){void 0!==this._$EC&&(this._$EC.forEach(((t,e)=>this._$EO(e,this[e],t))),this._$EC=void 0),this._$Ek()}updated(t){}firstUpdated(t){}}
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
var g;_.finalized=!0,_.elementProperties=new Map,_.elementStyles=[],_.shadowRootOptions={mode:"open"},null==p||p({ReactiveElement:_}),(null!==(h=globalThis.reactiveElementVersions)&&void 0!==h?h:globalThis.reactiveElementVersions=[]).push("1.3.4");const m=globalThis.trustedTypes,A=m?m.createPolicy("lit-html",{createHTML:t=>t}):void 0,y=`lit$${(Math.random()+"").slice(9)}$`,b="?"+y,S=`<${b}>`,E=document,w=(t="")=>E.createComment(t),C=t=>null===t||"object"!=typeof t&&"function"!=typeof t,x=Array.isArray,T=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,P=/-->/g,k=/>/g,N=RegExp(">|[ \t\n\f\r](?:([^\\s\"'>=/]+)([ \t\n\f\r]*=[ \t\n\f\r]*(?:[^ \t\n\f\r\"'`<>=]|(\"|')|))|$)","g"),R=/'/g,U=/"/g,H=/^(?:script|style|textarea|title)$/i,M=(t=>(e,...s)=>({_$litType$:t,strings:e,values:s}))(1),O=Symbol.for("lit-noChange"),I=Symbol.for("lit-nothing"),L=new WeakMap,B=E.createTreeWalker(E,129,null,!1),W=(t,e)=>{const s=t.length-1,i=[];let n,r=2===e?"<svg>":"",o=T;for(let e=0;e<s;e++){const s=t[e];let l,a,d=-1,h=0;for(;h<s.length&&(o.lastIndex=h,a=o.exec(s),null!==a);)h=o.lastIndex,o===T?"!--"===a[1]?o=P:void 0!==a[1]?o=k:void 0!==a[2]?(H.test(a[2])&&(n=RegExp("</"+a[2],"g")),o=N):void 0!==a[3]&&(o=N):o===N?">"===a[0]?(o=null!=n?n:T,d=-1):void 0===a[1]?d=-2:(d=o.lastIndex-a[2].length,l=a[1],o=void 0===a[3]?N:'"'===a[3]?U:R):o===U||o===R?o=N:o===P||o===k?o=T:(o=N,n=void 0);const c=o===N&&t[e+1].startsWith("/>")?" ":"";r+=o===T?s+S:d>=0?(i.push(l),s.slice(0,d)+"$lit$"+s.slice(d)+y+c):s+y+(-2===d?(i.push(void 0),e):c)}const l=r+(t[s]||"<?>")+(2===e?"</svg>":"");if(!Array.isArray(t)||!t.hasOwnProperty("raw"))throw Error("invalid template strings array");return[void 0!==A?A.createHTML(l):l,i]};class j{constructor({strings:t,_$litType$:e},s){let i;this.parts=[];let n=0,r=0;const o=t.length-1,l=this.parts,[a,d]=W(t,e);if(this.el=j.createElement(a,s),B.currentNode=this.el.content,2===e){const t=this.el.content,e=t.firstChild;e.remove(),t.append(...e.childNodes)}for(;null!==(i=B.nextNode())&&l.length<o;){if(1===i.nodeType){if(i.hasAttributes()){const t=[];for(const e of i.getAttributeNames())if(e.endsWith("$lit$")||e.startsWith(y)){const s=d[r++];if(t.push(e),void 0!==s){const t=i.getAttribute(s.toLowerCase()+"$lit$").split(y),e=/([.?@])?(.*)/.exec(s);l.push({type:1,index:n,name:e[2],strings:t,ctor:"."===e[1]?K:"?"===e[1]?q:"@"===e[1]?J:V})}else l.push({type:6,index:n})}for(const e of t)i.removeAttribute(e)}if(H.test(i.tagName)){const t=i.textContent.split(y),e=t.length-1;if(e>0){i.textContent=m?m.emptyScript:"";for(let s=0;s<e;s++)i.append(t[s],w()),B.nextNode(),l.push({type:2,index:++n});i.append(t[e],w())}}}else if(8===i.nodeType)if(i.data===b)l.push({type:2,index:n});else{let t=-1;for(;-1!==(t=i.data.indexOf(y,t+1));)l.push({type:7,index:n}),t+=y.length-1}n++}}static createElement(t,e){const s=E.createElement("template");return s.innerHTML=t,s}}function D(t,e,s=t,i){var n,r,o,l;if(e===O)return e;let a=void 0!==i?null===(n=s._$Cl)||void 0===n?void 0:n[i]:s._$Cu;const d=C(e)?void 0:e._$litDirective$;return(null==a?void 0:a.constructor)!==d&&(null===(r=null==a?void 0:a._$AO)||void 0===r||r.call(a,!1),void 0===d?a=void 0:(a=new d(t),a._$AT(t,s,i)),void 0!==i?(null!==(o=(l=s)._$Cl)&&void 0!==o?o:l._$Cl=[])[i]=a:s._$Cu=a),void 0!==a&&(e=D(t,a._$AS(t,e.values),a,i)),e}class z{constructor(t,e){this.v=[],this._$AN=void 0,this._$AD=t,this._$AM=e}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}p(t){var e;const{el:{content:s},parts:i}=this._$AD,n=(null!==(e=null==t?void 0:t.creationScope)&&void 0!==e?e:E).importNode(s,!0);B.currentNode=n;let r=B.nextNode(),o=0,l=0,a=i[0];for(;void 0!==a;){if(o===a.index){let e;2===a.type?e=new Y(r,r.nextSibling,this,t):1===a.type?e=new a.ctor(r,a.name,a.strings,this,t):6===a.type&&(e=new G(r,this,t)),this.v.push(e),a=i[++l]}o!==(null==a?void 0:a.index)&&(r=B.nextNode(),o++)}return n}m(t){let e=0;for(const s of this.v)void 0!==s&&(void 0!==s.strings?(s._$AI(t,s,e),e+=s.strings.length-2):s._$AI(t[e])),e++}}class Y{constructor(t,e,s,i){var n;this.type=2,this._$AH=I,this._$AN=void 0,this._$AA=t,this._$AB=e,this._$AM=s,this.options=i,this._$C_=null===(n=null==i?void 0:i.isConnected)||void 0===n||n}get _$AU(){var t,e;return null!==(e=null===(t=this._$AM)||void 0===t?void 0:t._$AU)&&void 0!==e?e:this._$C_}get parentNode(){let t=this._$AA.parentNode;const e=this._$AM;return void 0!==e&&11===t.nodeType&&(t=e.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,e=this){t=D(this,t,e),C(t)?t===I||null==t||""===t?(this._$AH!==I&&this._$AR(),this._$AH=I):t!==this._$AH&&t!==O&&this.T(t):void 0!==t._$litType$?this.$(t):void 0!==t.nodeType?this.k(t):(t=>x(t)||"function"==typeof(null==t?void 0:t[Symbol.iterator]))(t)?this.S(t):this.T(t)}j(t,e=this._$AB){return this._$AA.parentNode.insertBefore(t,e)}k(t){this._$AH!==t&&(this._$AR(),this._$AH=this.j(t))}T(t){this._$AH!==I&&C(this._$AH)?this._$AA.nextSibling.data=t:this.k(E.createTextNode(t)),this._$AH=t}$(t){var e;const{values:s,_$litType$:i}=t,n="number"==typeof i?this._$AC(t):(void 0===i.el&&(i.el=j.createElement(i.h,this.options)),i);if((null===(e=this._$AH)||void 0===e?void 0:e._$AD)===n)this._$AH.m(s);else{const t=new z(n,this),e=t.p(this.options);t.m(s),this.k(e),this._$AH=t}}_$AC(t){let e=L.get(t.strings);return void 0===e&&L.set(t.strings,e=new j(t)),e}S(t){x(this._$AH)||(this._$AH=[],this._$AR());const e=this._$AH;let s,i=0;for(const n of t)i===e.length?e.push(s=new Y(this.j(w()),this.j(w()),this,this.options)):s=e[i],s._$AI(n),i++;i<e.length&&(this._$AR(s&&s._$AB.nextSibling,i),e.length=i)}_$AR(t=this._$AA.nextSibling,e){var s;for(null===(s=this._$AP)||void 0===s||s.call(this,!1,!0,e);t&&t!==this._$AB;){const e=t.nextSibling;t.remove(),t=e}}setConnected(t){var e;void 0===this._$AM&&(this._$C_=t,null===(e=this._$AP)||void 0===e||e.call(this,t))}}class V{constructor(t,e,s,i,n){this.type=1,this._$AH=I,this._$AN=void 0,this.element=t,this.name=e,this._$AM=i,this.options=n,s.length>2||""!==s[0]||""!==s[1]?(this._$AH=Array(s.length-1).fill(new String),this.strings=s):this._$AH=I}get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}_$AI(t,e=this,s,i){const n=this.strings;let r=!1;if(void 0===n)t=D(this,t,e,0),r=!C(t)||t!==this._$AH&&t!==O,r&&(this._$AH=t);else{const i=t;let o,l;for(t=n[0],o=0;o<n.length-1;o++)l=D(this,i[s+o],e,o),l===O&&(l=this._$AH[o]),r||(r=!C(l)||l!==this._$AH[o]),l===I?t=I:t!==I&&(t+=(null!=l?l:"")+n[o+1]),this._$AH[o]=l}r&&!i&&this.P(t)}P(t){t===I?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,null!=t?t:"")}}class K extends V{constructor(){super(...arguments),this.type=3}P(t){this.element[this.name]=t===I?void 0:t}}const F=m?m.emptyScript:"";class q extends V{constructor(){super(...arguments),this.type=4}P(t){t&&t!==I?this.element.setAttribute(this.name,F):this.element.removeAttribute(this.name)}}class J extends V{constructor(t,e,s,i,n){super(t,e,s,i,n),this.type=5}_$AI(t,e=this){var s;if((t=null!==(s=D(this,t,e,0))&&void 0!==s?s:I)===O)return;const i=this._$AH,n=t===I&&i!==I||t.capture!==i.capture||t.once!==i.once||t.passive!==i.passive,r=t!==I&&(i===I||n);n&&this.element.removeEventListener(this.name,this,i),r&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){var e,s;"function"==typeof this._$AH?this._$AH.call(null!==(s=null===(e=this.options)||void 0===e?void 0:e.host)&&void 0!==s?s:this.element,t):this._$AH.handleEvent(t)}}class G{constructor(t,e,s){this.element=t,this.type=6,this._$AN=void 0,this._$AM=e,this.options=s}get _$AU(){return this._$AM._$AU}_$AI(t){D(this,t)}}const Q=window.litHtmlPolyfillSupport;
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
var Z,X;null==Q||Q(j,Y),(null!==(g=globalThis.litHtmlVersions)&&void 0!==g?g:globalThis.litHtmlVersions=[]).push("2.2.7");class tt extends _{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var t,e;const s=super.createRenderRoot();return null!==(t=(e=this.renderOptions).renderBefore)&&void 0!==t||(e.renderBefore=s.firstChild),s}update(t){const e=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=((t,e,s)=>{var i,n;const r=null!==(i=null==s?void 0:s.renderBefore)&&void 0!==i?i:e;let o=r._$litPart$;if(void 0===o){const t=null!==(n=null==s?void 0:s.renderBefore)&&void 0!==n?n:null;r._$litPart$=o=new Y(e.insertBefore(w(),t),t,void 0,null!=s?s:{})}return o._$AI(t),o})(e,this.renderRoot,this.renderOptions)}connectedCallback(){var t;super.connectedCallback(),null===(t=this._$Do)||void 0===t||t.setConnected(!0)}disconnectedCallback(){var t;super.disconnectedCallback(),null===(t=this._$Do)||void 0===t||t.setConnected(!1)}render(){return O}}tt.finalized=!0,tt._$litElement$=!0,null===(Z=globalThis.litElementHydrateSupport)||void 0===Z||Z.call(globalThis,{LitElement:tt});const et=globalThis.litElementPolyfillSupport;null==et||et({LitElement:tt}),(null!==(X=globalThis.litElementVersions)&&void 0!==X?X:globalThis.litElementVersions=[]).push("3.2.2");
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const st=2,it=t=>(...e)=>({_$litDirective$:t,values:e});class nt{constructor(t){}get _$AU(){return this._$AM._$AU}_$AT(t,e,s){this._$Ct=t,this._$AM=e,this._$Ci=s}_$AS(t,e){return this.update(t,e)}update(t,e){return this.render(...e)}}
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */class rt extends nt{constructor(t){if(super(t),this.it=I,t.type!==st)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(t){if(t===I||null==t)return this._t=void 0,this.it=t;if(t===O)return t;if("string"!=typeof t)throw Error(this.constructor.directiveName+"() called with a non-string value");if(t===this.it)return this._t;this.it=t;const e=[t];return e.raw=e,this._t={_$litType$:this.constructor.resultType,strings:e,values:[]}}}rt.directiveName="unsafeHTML",rt.resultType=1;const ot=it(rt),lt=(t,e)=>{var s,i;const n=t._$AN;if(void 0===n)return!1;for(const t of n)null===(i=(s=t)._$AO)||void 0===i||i.call(s,e,!1),lt(t,e);return!0},at=t=>{let e,s;do{if(void 0===(e=t._$AM))break;s=e._$AN,s.delete(t),t=e}while(0===(null==s?void 0:s.size))},dt=t=>{for(let e;e=t._$AM;t=e){let s=e._$AN;if(void 0===s)e._$AN=s=new Set;else if(s.has(t))break;s.add(t),ut(e)}};
/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */function ht(t){void 0!==this._$AN?(at(this),this._$AM=t,dt(this)):this._$AM=t}function ct(t,e=!1,s=0){const i=this._$AH,n=this._$AN;if(void 0!==n&&0!==n.size)if(e)if(Array.isArray(i))for(let t=s;t<i.length;t++)lt(i[t],!1),at(i[t]);else null!=i&&(lt(i,!1),at(i));else lt(this,t)}const ut=t=>{var e,s,i,n;t.type==st&&(null!==(e=(i=t)._$AP)&&void 0!==e||(i._$AP=ct),null!==(s=(n=t)._$AQ)&&void 0!==s||(n._$AQ=ht))};class pt extends nt{constructor(){super(...arguments),this._$AN=void 0}_$AT(t,e,s){super._$AT(t,e,s),dt(this),this.isConnected=t._$AU}_$AO(t,e=!0){var s,i;t!==this.isConnected&&(this.isConnected=t,t?null===(s=this.reconnected)||void 0===s||s.call(this):null===(i=this.disconnected)||void 0===i||i.call(this)),e&&(lt(this,t),at(this))}setValue(t){if((t=>void 0===t.strings)
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */(this._$Ct))this._$Ct._$AI(t,this);else{const e=[...this._$Ct._$AH];e[this._$Ci]=t,this._$Ct._$AI(e,this,0)}}disconnected(){}reconnected(){}}
/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const vt=()=>new $t;class $t{}const ft=new WeakMap,_t=it(class extends pt{render(t){return I}update(t,[e]){var s;const i=e!==this.Y;return i&&void 0!==this.Y&&this.rt(void 0),(i||this.lt!==this.ct)&&(this.Y=e,this.dt=null===(s=t.options)||void 0===s?void 0:s.host,this.rt(this.ct=t.element)),I}rt(t){var e;if("function"==typeof this.Y){const s=null!==(e=this.dt)&&void 0!==e?e:globalThis;let i=ft.get(s);void 0===i&&(i=new WeakMap,ft.set(s,i)),void 0!==i.get(this.Y)&&this.Y.call(this.dt,void 0),i.set(this.Y,t),void 0!==t&&this.Y.call(this.dt,t)}else this.Y.value=t}get lt(){var t,e,s;return"function"==typeof this.Y?null===(e=ft.get(null!==(t=this.dt)&&void 0!==t?t:globalThis))||void 0===e?void 0:e.get(this.Y):null===(s=this.Y)||void 0===s?void 0:s.value}disconnected(){this.lt===this.ct&&this.rt(void 0)}reconnected(){this.rt(this.ct)}});class gt extends tt{static styles=a`
		.loader {
			border: 4px solid #f3f3f3;
			border-radius: 50%;
			border-top: 4px solid #444444;
			width: 6px;
			height: 6px;
			animation: spin 1s linear infinite;
			display: inline-block;
		}

		@keyframes spin {
			100% {
				transform: rotate(360deg);
			}
		}
	`;render(){return M`<div class="loader"></div>`}}customElements.define("loader-element",gt);customElements.define("test-results-element",class extends tt{static properties={status:{type:String},header:{type:String},details:{type:String}};createRenderRoot(){return this}render(){return M`<div class="testcase ${this.status}">
						<span class="msg">${this.header}</span>
						</div>
						<pre><code>${this.details}</code></pre></div>
					</div>`}});class mt extends tt{static properties={name:{type:String},description:{type:String},codeLines:{type:String},codeHeader:{type:String},isLoading:{type:Boolean},enableRun:{type:Boolean,default:!1},runStatus:{type:String},resultsStatus:{type:String},resultsHeader:{type:String},resultsDetails:{type:String}};static styles=a`
		/* Layout proportions for the two Parsons columns */
		.starter {
			width: 40%;
		}
		.solution {
			width: 58%;
			margin-left: 2%;
		}
	`;starterRef=vt();solutionRef=vt();createRenderRoot(){return this}render(){let t='Test results will appear here after clicking "Run Tests" above.';return this.resultsStatus&&(t=M`<test-results-element
				status=${this.resultsStatus}
				header=${this.resultsHeader}
				details=${this.resultsDetails}
			></test-results-element>`),M`
			<!-- Problem description card -->
			<div class="row mt-3">
				<div class="col-sm-12">
					<div class="card">
						<div class="card-header">
							<h3>Problem Statement</h3>
						</div>
						<div class="card-body">${ot(this.description)}</div>
					</div>
				</div>
			</div>

			<!-- Parsons widget area: starter (trash) and solution columns -->
			<div class="row mt-4">
				<div class="col-sm-12">
					<div class="card">
						<div class="card-body">
							<div
								${_t(this.starterRef)}
								class="sortable-code starter"
							></div>
							<div
								${_t(this.solutionRef)}
								class="sortable-code solution"
							></div>
							<div style="clear:both"></div>
							<div class="row float-right">
								<div class="col-sm-12">
									<span style="margin-right: 8px">
										${this.runStatus&&M`<loader-element></loader-element>`}
										${this.runStatus}
									</span>
									<button
										@click=${this.onRun}
										type="button"
										class="btn btn-primary"
										?disabled=${!this.enableRun}
									>
										Run Tests
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Test results card -->
			<div class="row mt-4">
				<div class="col-sm-12">
					<div class="card">
						<div class="card-header">
							<h4>Test Cases</h4>
						</div>
						<div id="test_description">
							<div class="card-body">${t}</div>
						</div>
					</div>
				</div>
			</div>
		`}firstUpdated(){this.parsonsWidget=new ParsonsWidget({sortableId:this.solutionRef.value,trashId:this.starterRef.value}),this.parsonsWidget.init(this.codeLines),this.parsonsWidget.alphabetize()}onRun(){this.runStatus="Running code...",this.dispatchEvent(new CustomEvent("run",{detail:{code:this.parsonsWidget.solutionCode(),repr:this.parsonsWidget.reprCode()}}))}}customElements.define("problem-element",mt);class At{constructor(t){return this.gotCalledBack=!1,this.worker=new Worker("dist/worker.js"),this.worker.onmessage=this.handleMessage.bind(this),new Promise((e=>{window.setTimeout(this.finishIt.bind(this),6e4),this.worker.postMessage(t),this.resolve=e}))}finishIt(){this.gotCalledBack||(this.worker.terminate(),this.resolve({error:{message:"Infinite loop"}}))}handleMessage(t){this.gotCalledBack=!0,this.resolve(t.data)}}let yt,bt;async function St(){let n=new URL(document.location).searchParams;if(bt=n.get("id"),bt)try{const n=await fetch(`/api/tasks/${bt}`);if(!n.ok)throw new Error(`Failed to fetch task: ${n.statusText}`);const r=await n.json();let o={};try{o="string"==typeof r.description?JSON.parse(r.description):r.description}catch(t){o={function_name:"",description:r.description||"",examples:""}}let l="";o.function_name&&(l+=`<strong>${o.function_name}</strong>`),o.description&&(l+=` ${o.description}`),o.examples&&(l+=`<br><pre><code>${o.examples}</code></pre>`);const a=r.code_blocks,d=a.function_header;let h=function(t){let e=[];for(const s of t){let t="    ".repeat(s.indent)+s.code;t=t.replace(/___/g,"!BLANK"),s.given&&(t+=" #0given"),e.push(t)}return e.join("\n")}(a.blocks);h+="\nprint('DEBUG:', !BLANK)\nprint('DEBUG:', !BLANK)\n# !BLANK\n# !BLANK";const c=function(s,i){let n;return n=e()?localStorage.getItem(s):t[s],null==n?i:n}(bt+"-repr");c&&(h=c),yt=document.createElement("problem-element"),yt.setAttribute("name",bt),yt.setAttribute("description",l),yt.setAttribute("codeLines",h),yt.setAttribute("codeHeader",d),yt.setAttribute("runStatus","Loading Pyodide..."),yt.addEventListener("run",(n=>{!async function(n,r,o){let l=function(t,e){t+="\n";let i=e.split("\n");const n=function(t){let e=-1,s=!1;return t.forEach(((t,i)=>{if(t.trim().includes('"""')){if(s)return void(e=i+1);s=!0}})),e}(i),r=t.split("\n");if(!r[0].includes("def")&&!r[0].includes("class"))return{status:"fail",header:"Error running tests",details:"First code line must be `def` or `class` declaration"};if(r.shift(),s(r,0)!=r.length)return{status:"fail",header:"Error running tests",details:"All lines in a function or class definition should be indented at least once. It looks like you have a line that has no indentation."};const o=i.slice(0,n),l=s(i,n),a=i.slice(l);let d=[];return o.forEach((t=>{d.push(t)})),r.forEach((t=>{d.push(t)})),a.forEach((t=>{d.push(t)})),d.push("import sys"),d.push("import io"),d.push("sys.stdout = io.StringIO()"),d.push("import doctest"),d.push("doctest.testmod(verbose=True)"),d=d.join("\n"),{status:"success",header:"Running tests...",code:d,startLine:n}}(n,o);if(l.code)try{const t=l.code+"\nsys.stdout.getvalue()",{results:e,error:s}=await new At(t);l=e?function(t){const e=t.match(/(\d+)\spassed\sand\s(\d+)\sfailed./);if(e){const s=parseInt(e[1],10),i=s+parseInt(e[2],10);return{status:s==i?"pass":"fail",header:`${s} of ${i} tests passed`,details:function(t){let e=[],s=!1;return t.split("\n").forEach((t=>{t.startsWith('File "__main__"')?s=!0:((t.startsWith("Trying:")||t.startsWith("1 items had no tests:"))&&(s=!1),s&&(t=t.replace("Failed example:","\n❌ Failed example:"),e.push(t)))})),e.join("\n")}(t)}}}(e):function(t,e){return t.message.startsWith("Traceback")?{status:"fail",header:"Syntax error",details:i(t.message,e)}:"Infinite loop"==t.message?{status:"fail",header:"Infinite loop",details:"Your code did not finish executing within 60 seconds. Please look to see if you accidentally coded an infinite loop."}:{status:"fail",header:"Unexpected error occurred"}}(s,l.startLine)}catch(t){}yt.setAttribute("runStatus",""),yt.setAttribute("resultsStatus",l.status),yt.setAttribute("resultsHeader",l.header),yt.setAttribute("resultsDetails",l.details),a=bt+"-repr",d=r,e()?localStorage.setItem(a,d):t[a]=d;var a,d}(n.detail.code,n.detail.repr,d)})),yt.setAttribute("enableRun","enableRun"),yt.setAttribute("runStatus",""),document.getElementById("problem-wrapper").appendChild(yt)}catch(t){document.getElementById("problem-wrapper").innerHTML=`<p>Error loading task: ${t.message}</p>`}else document.getElementById("problem-wrapper").innerHTML="<p>Error: No task ID provided</p>"}export{St as initWidget};
//# sourceMappingURL=bundle.js.map
