import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { IDBPDatabase } from 'idb';
import Decimal from 'decimal.js';
import { aggregate, costDefaults, filterSales, makeSale, menuSummaries, periodState, saleAmounts, validateDraft, validatePeriod, won, type Dataset, type Draft, type Money, type Period, type Sale } from './domain';
import { connect, errorMessage, initialized, load, putSale, removeSale, seed, type Workspace } from './storage';
import s from './App.module.css';

const number=(n:number)=>n.toLocaleString('ko-KR');
const monthEnd=(month:string)=>{if(!/^\d{4}-\d{2}$/.test(month))return '';const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};
const getView=()=>window.location.hash==='#/menus'?'menus':'sales';
export class ErrorBoundary extends Component<{children:ReactNode},{error:boolean}>{
  state={error:false};static getDerivedStateFromError(){return {error:true};}
  render(){return this.state.error?<div className={s.failure}><h1>화면을 표시하지 못했습니다.</h1><p>기록을 새 자료로 덮어쓰지 않았습니다. 다시 열어 확인해 주세요.</p><button onClick={()=>location.reload()}>다시 열기</button></div>:this.props.children;}
}
export default function App(){
  const [db,setDb]=useState<IDBPDatabase|null>(null);const [workspace,setWorkspace]=useState<Workspace|null>(null);
  const [bootError,setBootError]=useState('');const [attempt,setAttempt]=useState(0);const [view,setView]=useState(getView);const [readyMs,setReadyMs]=useState<number|null>(null);
  const [period,setPeriod]=useState<Period>({start:'2025-07-01',end:'2026-09-18'});const [periodDraft,setPeriodDraft]=useState(period);
  const [mode,setMode]=useState<'day'|'month'|'custom'>('custom');const [queryError,setQueryError]=useState('');
  const [menuId,setMenuId]=useState('');const [channel,setChannel]=useState('');const [category,setCategory]=useState('');const [sort,setSort]=useState('profit');const [page,setPage]=useState(1);
  const [editing,setEditing]=useState<{sale?:Sale;revision:number}|null>(null);const [deleting,setDeleting]=useState<{sale:Sale;revision:number}|null>(null);
  const [busy,setBusy]=useState(false);const busyRef=useRef(false);const [saveStatus,setSaveStatus]=useState('자료 준비 중');const [toast,setToast]=useState('');const [deleteError,setDeleteError]=useState('');
  const broadcast=useRef<BroadcastChannel|null>(null);
  useEffect(()=>{const change=()=>{setView(getView());setPage(1);};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(()=>{
    let gone=false;let connection:IDBPDatabase|undefined;setBootError('');
    (async()=>{
      const opened=await connect();connection=opened;
      if(!await initialized(opened)){
        const response=await fetch('/sample/store.json');if(!response.ok)throw new Error('제공 자료를 읽지 못했습니다. 다시 시도해 주세요.');
        await seed(opened,await response.json());
      }
      const loaded=await load(opened);if(gone)return;setDb(opened);setWorkspace(loaded);setSaveStatus('저장됨');
      const bc=new BroadcastChannel('prep-cafe-ops-changes');broadcast.current=bc;
      bc.onmessage=()=>{load(opened).then(fresh=>{if(!gone){setWorkspace(fresh);setToast('다른 화면의 변경을 반영했습니다. 열린 입력창은 최신 기록을 다시 확인해 주세요.');}}).catch(e=>{if(!gone)setSaveStatus(`저장 자료 확인 실패: ${errorMessage(e)}`);});};
    })().catch(e=>{if(!gone){setBootError(errorMessage(e));setSaveStatus('자료 확인 실패');}});
    return()=>{gone=true;broadcast.current?.close();connection?.close();};
  },[attempt]);
  useEffect(()=>{if(workspace&&readyMs===null)setReadyMs(Math.round(performance.now()));},[workspace,readyMs]);
  const data=workspace?.data;
  const filtered=useMemo(()=>data?filterSales(data,period,view==='sales'?menuId:'',channel):[],[data,period,menuId,channel,view]);
  const listed=useMemo(()=>[...filtered].sort((a,b)=>b.date.localeCompare(a.date)||a.sale_id.localeCompare(b.sale_id)),[filtered]);
  const menuRows=useMemo(()=>{
    if(!data||view!=='menus')return [];
    const rows=menuSummaries(data,filtered).filter(r=>!category||r.menu.category===category);
    return rows.sort((a,b)=>{
      const av=sort==='quantity'?String(a.quantity):sort==='rate'?a.rate:a.profit;const bv=sort==='quantity'?String(b.quantity):sort==='rate'?b.rate:b.profit;
      if(av===null&&bv!==null)return 1;if(bv===null&&av!==null)return -1;
      return av!==null&&bv!==null?new Decimal(bv).cmp(av)||a.menu.menu_id.localeCompare(b.menu.menu_id):a.menu.menu_id.localeCompare(b.menu.menu_id);
    });
  },[data,filtered,category,sort,view]);
  const summary=useMemo(()=>aggregate(view==='menus'&&category&&data?filtered.filter(sale=>data.menus.find(m=>m.menu_id===sale.menu_id)?.category===category):filtered),[filtered,view,category,data]);
  const calendar=data?periodState(data,period):null;
  const emptyResult=summary.count===0&&calendar?.partial?'기록 없음':undefined;
  useEffect(()=>setPage(1),[period,menuId,channel,view]);
  const pages=Math.max(1,Math.ceil(listed.length/50));const actualPage=Math.min(page,pages);
  async function persist(sale:Sale,expected:number,isEdit:boolean){
    if(!db||busyRef.current)return;busyRef.current=true;setBusy(true);setSaveStatus('저장 중');
    try{
      await putSale(db,sale,expected,isEdit?'edit':'add');
      const fresh=await load(db);setWorkspace(fresh);setEditing(null);setSaveStatus('저장됨');setToast(isEdit?'판매 기록을 정정했습니다.':'판매 집계 기록을 추가했습니다.');broadcast.current?.postMessage({revision:fresh.revision});
    }catch(e){setSaveStatus('저장 실패 · 입력 내용 유지');throw e;}finally{busyRef.current=false;setBusy(false);}
  }
  async function confirmDelete(){
    if(!db||!deleting||busyRef.current)return;busyRef.current=true;setBusy(true);setDeleteError('');setSaveStatus('저장 중');
    try{await removeSale(db,deleting.sale.sale_id,deleting.revision);const fresh=await load(db);setWorkspace(fresh);setDeleting(null);setSaveStatus('저장됨');setToast('해당 판매만 삭제했습니다.');broadcast.current?.postMessage({revision:fresh.revision});}
    catch(e){setDeleteError(errorMessage(e));setSaveStatus('삭제 실패 · 기존 기록 유지');}finally{busyRef.current=false;setBusy(false);}
  }
  function applyPeriod(){const error=validatePeriod(periodDraft);if(error){setQueryError(error);return;}setPeriod({...periodDraft});setQueryError('');}
  function chooseMode(next:typeof mode){setMode(next);const end=period.end;if(next==='day')setPeriodDraft({start:end,end});else if(next==='month')setPeriodDraft({start:end.slice(0,7)+'-01',end:monthEnd(end.slice(0,7))});else setPeriodDraft({...period});}
  return <div className={s.shell}>
    <aside className={s.sidebar}>
      <div className={s.brand}><span className={s.monogram}>P</span><div><strong>프렙 카페</strong><small>판매와 메뉴 수익성</small></div></div>
      <div className={s.store}>본점 <span>단일 매장</span></div>
      <nav aria-label="주요 화면">
        <a href="#/sales" className={view==='sales'?s.active:''} aria-current={view==='sales'?'page':undefined}>▤ 판매 기록 관리</a>
        <a href="#/menus" className={view==='menus'?s.active:''} aria-current={view==='menus'?'page':undefined}>◷ 메뉴별 수익성 분석</a>
        <div className={s.future}>기간별 실적 및 손익 <small>EPIC 2 예정</small></div>
        <div className={s.future}>비용 기록 관리 <small>EPIC 2 예정</small></div>
        <div className={s.future}>재료 잔량 및 부족 현황 <small>EPIC 2 예정</small></div>
      </nav>
      <div className={s.sideFoot}><span>지정 브라우저에 저장</span><small>가상 자료로 기능을 확인해 주세요.</small></div>
    </aside>
    <div className={s.content}>
      <header className={s.topbar}><span>본점 / 단일 매장</span><div><span>마지막 마감일 <strong>{data?.meta.as_of??'확인 중'}</strong></span><span className={saveStatus==='저장됨'?s.saved:s.warning} role="status">● {saveStatus}</span></div></header>
      <div className={s.meta}>가상 매장 샘플 · 기록 기간 {data?`${data.meta.start_date} ~ ${data.meta.as_of}`:'자료 준비 중'} <span>금액: 원 · 부가세 제외</span></div>
      <main data-ready-ms={readyMs??undefined}>
        {bootError?<section className={s.error} role="alert"><h1>자료를 열지 못했습니다.</h1><p>{bootError}</p><p>기존 자료를 새 샘플로 덮어쓰지 않았습니다.</p><button onClick={()=>setAttempt(x=>x+1)}>다시 시도</button></section>:!data?<section className={s.loading} aria-live="polite">제공 기록을 검사하고 준비하고 있습니다…</section>:<>
          <div className={s.heading}><div><span className={s.eyebrow}>PREP CAFE / OPERATIONS</span><h1>{view==='sales'?'판매 기록 관리':'메뉴별 수익성 분석'}</h1><p>{view==='sales'?'일자·메뉴·채널별 집계를 기록하고 바로잡습니다.':'판매에서 식재료·포장재·수수료를 제외하고 남는 금액을 확인합니다.'}</p></div>{view==='sales'&&<button className={s.primary} onClick={()=>setEditing({revision:workspace!.revision})} disabled={busy}>＋ 신규 판매 기록 추가</button>}</div>
          <section className={s.query} aria-label="기간과 조회 조건">
            <div className={s.segment}>{(['day','month','custom'] as const).map((key,i)=><button key={key} className={mode===key?s.selected:''} onClick={()=>chooseMode(key)}>{['일간','월간','직접 지정'][i]}</button>)}</div>
            <div className={s.queryFields}>
              {mode==='month'?<label>조회 월<input aria-label="조회 월" type="month" value={periodDraft.start.slice(0,7)} onInput={e=>setPeriodDraft({start:e.currentTarget.value?e.currentTarget.value+'-01':'',end:monthEnd(e.currentTarget.value)})}/></label>:<><label>{mode==='day'?'조회 일자':'시작일'}<input type="date" value={periodDraft.start} onInput={e=>setPeriodDraft(mode==='day'?{start:e.currentTarget.value,end:e.currentTarget.value}:{...periodDraft,start:e.currentTarget.value})}/></label>{mode==='custom'&&<label>종료일<input type="date" value={periodDraft.end} onInput={e=>setPeriodDraft({...periodDraft,end:e.currentTarget.value})}/></label>}</>}
              <button onClick={applyPeriod}>조회 적용</button>
              {view==='sales'?<label>메뉴<select value={menuId} onChange={e=>setMenuId(e.target.value)}><option value="">전체 메뉴</option>{data.menus.map(m=><option key={m.menu_id} value={m.menu_id}>{m.name}</option>)}</select></label>:<label>메뉴 분류<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">전체 메뉴</option><option value="음료">음료</option><option value="디저트">디저트</option></select></label>}
              <label>판매채널<select value={channel} onChange={e=>setChannel(e.target.value)}><option value="">전체 채널</option><option>매장</option><option>포장</option></select></label>
            </div>
            {queryError&&<p className={s.fieldError} role="alert">{queryError}</p>}
            <div className={s.range}>적용된 조회: <strong>{period.start} ~ {period.end}</strong><span>마감 달력 {calendar!.closed}일 · 미마감 {calendar!.unclosed}일 {calendar!.unknown>0?`· 달력 미확인 ${calendar!.unknown}일`:''}</span></div>
          </section>
          {calendar?.partial&&<div className={s.notice}>미마감 또는 달력이 없는 기간을 포함한 부분 기록입니다. 입력된 기록을 조회하며, 마감된 실적이나 판매 0으로 확정하지 않습니다.</div>}
          {toast&&<div className={s.toast} role="status">{toast}<button aria-label="알림 닫기" onClick={()=>setToast('')}>×</button></div>}
          <section className={s.metrics} aria-label="조회 결과 요약">
            <Metric label="조회 판매수량" value={String(summary.quantity)} unit="잔·개" foot={`${number(summary.count)}건의 일별 집계`} display={emptyResult}/>
            <Metric label="순매출" value={summary.net} unit="원" foot="총 할인 차감 후" display={emptyResult}/>
            <Metric label="식재료·포장 원가" value={summary.food===null||summary.packaging===null?null:new Decimal(summary.food).add(summary.packaging).toString()} unit="원" foot="기록별 원 단위 반올림" display={emptyResult}/>
            <Metric label="기여이익" value={summary.profit} unit="원" foot={summary.rate===null?'비율 계산 불가':`기여이익률 ${summary.rate}%`} display={emptyResult} accent/>
          </section>
          {summary.missing>0&&<div className={s.notice}>원가·수수료 또는 기록 확인이 필요한 집계 {summary.missing}건. 미확인 값을 0으로 처리하지 않습니다.</div>}
          {view==='sales'?<section className={s.tableCard}><div className={s.tableHead}><h2>판매 집계 기록</h2><span>조회 전체 {number(listed.length)}건 · 한 페이지 50건</span></div><div className={s.tableScroll}><table><caption className={s.srOnly}>선택 기간의 판매 기록</caption><thead><tr>{['일자 / 판매ID','메뉴','채널','수량','당시 단가','총 할인','순매출','총 수수료','식재료 원가','포장 원가','확인 상태','작업'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
            {listed.slice((actualPage-1)*50,actualPage*50).map(sale=>{const a=saleAmounts(sale);const menu=data.menus.find(m=>m.menu_id===sale.menu_id);const day=data.calendar.find(d=>d.date===sale.date);return <tr key={sale.sale_id}><td>{sale.date}<small title={sale.sale_id}>{sale.sale_id.slice(0,12)}</small></td><td>{menu?.name??sale.menu_id}</td><td><span className={sale.channel==='포장'?s.takeout:s.badge}>{sale.channel}</span></td><td className={s.numeric}>{number(sale.quantity)}{menu?.category==='디저트'?'개':'잔'}</td><td className={s.numeric}>{won(sale.unit_price)}</td><td className={s.numeric}>{won(sale.discount_amount)}</td><td className={s.numeric}>{won(sale.net_sales)}</td><td className={s.numeric}>{won(sale.payment_fee)}</td><td className={s.numeric}>{won(a.food)}</td><td className={s.numeric}>{won(a.packaging)}</td><td><span className={a.issues.length?s.warning:s.saved}>{a.issues.length?'금액 미확인':'금액 확인'}</span><small>{day?.record_complete?'마감 기록':day?'미마감':'마감 미확인'}</small>{a.issues.map(issue=><small className={s.warning} key={issue}>{issue}</small>)}</td><td><div className={s.actions}><button aria-label={`${sale.date} ${menu?.name} ${sale.channel} 수정`} onClick={()=>setEditing({sale,revision:workspace!.revision})} disabled={busy}>수정</button><button className={s.dangerText} aria-label={`${sale.date} ${menu?.name} ${sale.channel} 삭제`} onClick={()=>{setDeleteError('');setDeleting({sale,revision:workspace!.revision});}} disabled={busy}>삭제</button></div></td></tr>;})}
            {!listed.length&&<tr><td colSpan={12} className={s.empty}>선택 조건에 판매 기록이 없습니다. 미마감·자료 없음은 판매 0과 다릅니다.</td></tr>}
          </tbody></table></div><div className={s.pagination}><span>전체 기록은 브라우저에 {number(data.sales.length)}건 저장되어 있습니다.</span><div><button disabled={actualPage===1} onClick={()=>setPage(actualPage-1)}>이전</button><span>{actualPage} / {pages}</span><button disabled={actualPage===pages} onClick={()=>setPage(actualPage+1)}>다음</button></div></div></section>:<section className={s.tableCard}><div className={s.tableHead}><h2>메뉴별 판매 기여도</h2><label>정렬<select value={sort} onChange={e=>setSort(e.target.value)}><option value="profit">기여이익 순</option><option value="rate">이익률 순</option><option value="quantity">판매량 순</option></select></label></div><div className={s.tableScroll}><table><caption className={s.srOnly}>메뉴별 수익성 집계</caption><thead><tr>{['메뉴 / 레시피','판매수량','실제 평균 단가','순매출','식재료 원가','포장 원가','총 수수료','기여이익','이익률','상태'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{menuRows.map(row=><tr key={row.menu.menu_id}><td><strong>{row.menu.name}</strong><small>{row.menu.category} · {row.menu.recipe_version} · 기준가 {won(String(row.menu.price))}원</small></td><td className={s.numeric}>{number(row.quantity)}</td><td className={s.numeric}>{row.averagePrice===null?'—':won(row.averagePrice)}</td><td className={s.numeric}>{won(row.net)}</td><td className={s.numeric}>{won(row.food)}</td><td className={s.numeric}>{won(row.packaging)}</td><td className={s.numeric}>{won(row.fee)}</td><td className={`${s.numeric} ${s.profit}`}>{row.count?won(row.profit):'—'}</td><td className={s.numeric}>{row.rate===null?'계산 불가':`${row.rate}%`}</td><td>{!row.count?'판매 없음':row.missing?`미확인 ${row.missing}건`:'금액 확인'}</td></tr>)}</tbody></table></div><p className={s.footnote}>기여이익 = 순매출 − 식재료 원가 − 포장 원가 − 총 결제수수료. 임차료·인건비 등 운영비용은 포함하지 않습니다. 수수료는 실제 기록값을 사용합니다.</p></section>}
          <p className={s.footnote}>기록은 이 브라우저에 저장됩니다. 브라우저 자료 삭제·다른 주소·다른 브라우저에서는 자동으로 이어지지 않습니다. 지금은 가상 자료 검수 단계입니다.</p>
        </>}
      </main>
    </div>
    {data&&editing&&<SaleForm data={data} original={editing.sale} period={period} busy={busy} onSave={sale=>persist(sale,editing.revision,!!editing.sale)} onClose={()=>{setEditing(null);setSaveStatus('저장됨');}}/>}
    {deleting&&data&&<ConfirmDelete sale={deleting.sale} menuName={data.menus.find(m=>m.menu_id===deleting.sale.menu_id)?.name??deleting.sale.menu_id} busy={busy} error={deleteError} onCancel={()=>setDeleting(null)} onConfirm={confirmDelete}/>}
  </div>;
}
function Metric({label,value,unit,foot,display,accent=false}:{label:string;value:Money;unit:string;foot:string;display?:string;accent?:boolean}){return <article className={`${s.metric} ${accent?s.accent:''}`}><span>{label}</span><div>{display??won(value)}{value!==null&&!display&&<small>{unit}</small>}</div><p>{foot}</p></article>;}
function useDialog(ref:React.RefObject<HTMLDivElement|null>,close:()=>void){
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const el=ref.current;el?.querySelector<HTMLElement>('input,button,select')?.focus();
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'&&el){const focusable=[...el.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
    document.addEventListener('keydown',key);const old=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=old;previous?.focus();};
  },[ref,close]);
}
function SaleForm({data,original,period,busy,onSave,onClose}:{data:Dataset;original?:Sale;period:Period;busy:boolean;onSave:(sale:Sale)=>Promise<void>;onClose:()=>void}){
  const initial=useMemo<Draft>(()=>{
    if(original)return {date:original.date,menu_id:original.menu_id,channel:original.channel,quantity:String(original.quantity),unit_price:original.unit_price,discount_amount:original.discount_amount,food:original.unit_food_cost_snapshot??'',packaging:original.unit_packaging_cost_snapshot??'',fee:original.payment_fee??''};
    const menu=data.menus[0];const defaults=costDefaults(data,menu.menu_id,period.end,'매장');return {date:period.end,menu_id:menu.menu_id,channel:'매장',quantity:'1',unit_price:String(menu.price),discount_amount:'0',food:defaults.food??'',packaging:defaults.packaging??'',fee:''};
  },[]);
  const [draft,setDraft]=useState(initial);const [errors,setErrors]=useState<Record<string,string>>({});const [saveError,setSaveError]=useState('');const [feeAcknowledged,setFeeAcknowledged]=useState(false);const [discardConfirm,setDiscardConfirm]=useState(false);const [pendingBasis,setPendingBasis]=useState<Draft|null>(null);
  const dirty=JSON.stringify(initial)!==JSON.stringify(draft);const dirtyRef=useRef(dirty);dirtyRef.current=dirty;const busyForm=useRef(busy);busyForm.current=busy;const dialog=useRef<HTMLDivElement>(null);const pending=useRef(false);const costOverridden=useRef(false);
  const closeRef=useRef(()=>{});closeRef.current=()=>{if(busyForm.current)return;if(dirtyRef.current)setDiscardConfirm(true);else onClose();};
  const stableClose=useRef(()=>closeRef.current()).current;useDialog(dialog,stableClose);
  useEffect(()=>{const exit=(e:BeforeUnloadEvent)=>{if(dirtyRef.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',exit);return()=>window.removeEventListener('beforeunload',exit);},[]);
  const menu=data.menus.find(m=>m.menu_id===draft.menu_id);const defaults=costDefaults(data,draft.menu_id,draft.date,draft.channel);
  const needFeeAck=!!original&&original.payment_fee!==null&&(draft.quantity!==initial.quantity||draft.unit_price!==initial.unit_price||draft.discount_amount!==initial.discount_amount||draft.date!==initial.date||draft.channel!==initial.channel||draft.menu_id!==initial.menu_id);
  let preview:ReturnType<typeof saleAmounts>|undefined,previewNet:Money=null;
  try{if(!Object.keys(validateDraft(data,draft)).length){const record=makeSale(data,draft,original);preview=saleAmounts(record);previewNet=record.net_sales;}}catch{}
  function change(key:keyof Draft,value:string){
    if(['date','menu_id','channel'].includes(key)){
      const next={...draft,[key]:value} as Draft;const proposed=costDefaults(data,next.menu_id,next.date,next.channel);
      next.food=proposed.food??'';next.packaging=proposed.packaging??'';if(key==='menu_id')next.unit_price=String(data.menus.find(m=>m.menu_id===value)?.price??'');
      if(original||costOverridden.current){setPendingBasis(next);return;}
      costOverridden.current=false;setDraft(next);
    }else {if(key==='food'||key==='packaging')costOverridden.current=true;setDraft({...draft,[key]:value});}
    setErrors({...errors,[key]:''});setSaveError('');if(!['food','packaging'].includes(key))setFeeAcknowledged(false);
  }
  async function save(e:React.FormEvent){e.preventDefault();if(busy||pending.current)return;const problems=validateDraft(data,draft);setErrors(problems);if(Object.keys(problems).length){setSaveError('입력 오류를 확인해 주세요. 기록은 저장하지 않았습니다.');return;}if(needFeeAck&&!feeAcknowledged){setSaveError('변경한 판매의 총 결제수수료를 확인하고 확인란을 선택해 주세요.');return;}
    pending.current=true;try{await onSave(makeSale(data,draft,original));}catch(error){setSaveError(errorMessage(error));}finally{pending.current=false;}
  }
  function field(key:keyof Draft,label:string,optional=false){return <label className={s.formField}>{label}{!optional&&<span className={s.required}> *</span>}<input aria-invalid={!!errors[key]} aria-describedby={errors[key]?`error-${key}`:undefined} name={key} type="text" inputMode={key==='quantity'?'numeric':'decimal'} value={draft[key]} onChange={e=>change(key,e.target.value)} disabled={busy}/>{errors[key]&&<small id={`error-${key}`} className={s.fieldError}>{errors[key]}</small>}</label>;}
  return <div className={s.overlay}><div ref={dialog} className={s.modal} role="dialog" aria-modal="true" aria-labelledby="sale-dialog-title"><form onSubmit={save} noValidate>
    <header className={s.modalHead}><div><span className={s.eyebrow}>일자·메뉴·채널별 집계</span><h2 id="sale-dialog-title">{original?'판매 기록 수정':'신규 판매 기록 입력'}</h2><p>원가·수수료는 확인된 기록을 사용하며 직접 정정할 수 있습니다.</p></div><button type="button" aria-label="판매 입력창 닫기" onClick={stableClose} disabled={busy}>×</button></header>
    <div className={s.modalBody}>
      {discardConfirm&&<div className={s.notice} role="alert"><p>아직 저장하지 않은 입력을 버리고 닫을까요? 저장된 기록은 유지됩니다.</p><div className={s.actions}><button type="button" onClick={()=>setDiscardConfirm(false)}>입력 계속하기</button><button type="button" onClick={onClose}>입력을 버리고 닫기</button></div></div>}
      {pendingBasis&&<div className={s.notice} role="alert"><p>판매 기준을 {pendingBasis.date} · {data.menus.find(m=>m.menu_id===pendingBasis.menu_id)?.name} · {pendingBasis.channel}(으)로 바꾸면 이전 원가가 유효하지 않을 수 있습니다. 변경 기준의 기본 원가를 적용하고 직접 확인해 주세요.</p><div className={s.actions}><button type="button" onClick={()=>setPendingBasis(null)}>기준 변경 취소</button><button type="button" onClick={()=>{setDraft(pendingBasis);setPendingBasis(null);costOverridden.current=false;setFeeAcknowledged(false);setSaveError('');}}>변경 기준 적용</button></div></div>}
      <div className={s.formGrid}>
        <div className={s.formColumn}><label className={s.formField}>판매일자 <span className={s.required}>*</span><input type="date" name="date" value={draft.date} onInput={e=>change('date',e.currentTarget.value)} disabled={busy} aria-invalid={!!errors.date}/>{errors.date&&<small className={s.fieldError}>{errors.date}</small>}</label>
          <label className={s.formField}>메뉴 <span className={s.required}>*</span><select name="menu_id" value={draft.menu_id} onChange={e=>change('menu_id',e.target.value)} disabled={busy}>{data.menus.map(m=><option key={m.menu_id} value={m.menu_id}>{m.name} · 기준가 {won(String(m.price))}원 · {m.recipe_version}</option>)}</select></label>
          <fieldset className={s.channels}><legend>판매채널 *</legend>{(['매장','포장'] as const).map(c=><label key={c} className={draft.channel===c?s.chosen:''}><input type="radio" name="channel" value={c} checked={draft.channel===c} onChange={()=>change('channel',c)} disabled={busy}/>{c}<small>{c==='포장'?'등록된 포장세트 사용':'포장 전용 재료 미사용'}</small></label>)}</fieldset>
          <div className={s.notice}>수량은 주문 건수가 아니라 해당 일자·메뉴·채널의 총 판매수량입니다. 저장 전에는 원본 기록과 재료 사용에 반영되지 않습니다.</div>
        </div><div className={s.formColumn}>{field('quantity',`판매수량 (${menu?.category==='디저트'?'개':'잔'})`)}{field('unit_price','판매 당시 단가 (원 · 부가세 제외)')}{field('discount_amount','적용 총 할인액 (원)')}<div className={s.preview}><span>계산된 순매출</span><strong>{previewNet===null?'입력 확인 필요':`${won(previewNet)}원`}</strong></div></div>
      </div>
      <section className={s.costPanel}><div className={s.tableHead}><h3>원가·수수료 확인</h3><span>{original?'당시 기록 보존 · 직접 정정 가능':'등록 레시피·판매일 가격 참고'}</span></div><div className={s.costGrid}>{field('food','개당 식재료 원가 (원)',true)}{field('packaging','개당 포장 원가 (원)',true)}{field('fee','총 결제수수료 (원)',true)}</div>
        <p>빈칸은 미확인, 확인하여 입력한 0은 실제 0입니다. 확인된 수수료율이 없어 신규 수수료는 직접 입력합니다.</p>
        {defaults.issues.map(issue=><p className={s.warning} key={issue}>{issue}</p>)}
        {needFeeAck&&<div className={s.notice}><label className={s.check}><input type="checkbox" checked={feeAcknowledged} onChange={e=>setFeeAcknowledged(e.target.checked)} disabled={busy}/>변경한 판매의 총 결제수수료를 확인했습니다.</label><p>수량·할인·판매 기준 변경만으로 이전 수수료를 자동으로 덮어쓰지 않습니다.</p></div>}
        <div className={s.previewRow}><div><span>총 직접비</span><strong>{preview?`${won(preview.direct)}${preview.direct===null?'':'원'}`:'입력 확인 필요'}</strong></div><div><span>판매 기여이익</span><strong>{preview?`${won(preview.profit)}${preview.profit===null?'':'원'}`:'입력 확인 필요'}</strong></div><div><span>기여이익률</span><strong>{preview?.rate===null||!preview?'계산 불가':`${preview.rate}%`}</strong></div></div>
      </section>
      {saveError&&<div className={s.error} role="alert">{saveError}</div>}
    </div>
    <footer className={s.modalFoot}><span>저장 성공 후 기록·메뉴 집계를 갱신합니다.</span><div><button type="button" onClick={stableClose} disabled={busy}>취소</button><button type="submit" className={s.primary} disabled={busy||!!pendingBasis||discardConfirm}>{busy?'저장 중…':'입력 내용 확인 후 저장'}</button></div></footer>
  </form></div></div>;
}
function ConfirmDelete({sale,menuName,busy,error,onCancel,onConfirm}:{sale:Sale;menuName:string;busy:boolean;error:string;onCancel:()=>void;onConfirm:()=>void}){
  const ref=useRef<HTMLDivElement>(null);const cancelRef=useRef(()=>{});cancelRef.current=()=>{if(!busy)onCancel();};const stable=useRef(()=>cancelRef.current()).current;useDialog(ref,stable);
  return <div className={s.overlay}><div className={s.confirm} ref={ref} role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">이 판매 집계를 삭제할까요?</h2><p>{sale.date} · {menuName} · {sale.channel} · {sale.quantity}잔·개</p><p>판매 기록과 관련 집계에서 제외됩니다. 실측·재고기록은 유지합니다.</p>{error&&<div role="alert" className={s.error}>{error}</div>}<div className={s.confirmActions}><button onClick={onCancel} disabled={busy}>취소</button><button className={s.danger} onClick={onConfirm} disabled={busy}>{busy?'삭제 중…':'삭제 실행'}</button></div></div></div>;
}
