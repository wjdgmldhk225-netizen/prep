import { openDB, type IDBPDatabase } from 'idb';
import { parseDataset, saleKey, type Dataset, type Sale } from './domain';

export type Workspace={data:Dataset;revision:number};
const names=['workspaceMeta','masters','sales','expenses','openingInventory','inventoryEvents','calendar','monthlyExpensePlan'];
export class StoreError extends Error {constructor(public code:string,message:string){super(message);}}
export async function connect(name='prep-cafe-ops'):Promise<IDBPDatabase>{
  return openDB(name,1,{upgrade(db){
    db.createObjectStore('workspaceMeta'); db.createObjectStore('masters');
    const sales=db.createObjectStore('sales',{keyPath:'sale_id'});sales.createIndex('date','date');sales.createIndex('group',['date','menu_id','channel'],{unique:true});
    db.createObjectStore('expenses',{keyPath:'expense_id'});db.createObjectStore('openingInventory',{keyPath:'material_id'});
    db.createObjectStore('inventoryEvents',{keyPath:'event_id'});db.createObjectStore('calendar',{keyPath:'date'});
    db.createObjectStore('monthlyExpensePlan',{keyPath:['month','category']});
  }});
}
export async function seed(db:IDBPDatabase,input:unknown){
  const parsed=parseDataset(input);const tx=db.transaction(names,'readwrite');
  try{
    if(await tx.objectStore('workspaceMeta').get('active')){await tx.done;return;}
    await tx.objectStore('workspaceMeta').add({meta:parsed.meta,settings:parsed.settings,revision:0,schemaVersion:1,calculationVersion:'frd-1'},'active');
    for(const k of ['menus','materials','suppliers','recipes','price_history'] as const)await tx.objectStore('masters').add(parsed[k],k);
    for(const [store,key] of [['sales','sales'],['expenses','expenses'],['openingInventory','opening_inventory'],['inventoryEvents','inventory_events'],['calendar','calendar'],['monthlyExpensePlan','monthly_expense_plan']] as const)
      for(const row of parsed[key])await tx.objectStore(store).add(row);
    await tx.done;
  }catch(e){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw e;}
}
export async function load(db:IDBPDatabase):Promise<Workspace>{
  const tx=db.transaction(names,'readonly');
  const meta=await tx.objectStore('workspaceMeta').get('active');
  if(!meta)throw new StoreError('EMPTY','아직 자료가 준비되지 않았습니다.');
  if(meta.schemaVersion!==1||meta.calculationVersion!=='frd-1'||!Number.isSafeInteger(meta.revision))throw new StoreError('VERSION','지원하지 않는 저장 자료입니다. 기존 자료를 덮어쓰지 않았습니다.');
  const data:any={meta:meta.meta,settings:meta.settings};
  for(const key of ['menus','materials','suppliers','recipes','price_history'])data[key]=await tx.objectStore('masters').get(key);
  for(const [store,key] of [['sales','sales'],['expenses','expenses'],['openingInventory','opening_inventory'],['inventoryEvents','inventory_events'],['calendar','calendar'],['monthlyExpensePlan','monthly_expense_plan']])data[key]=await tx.objectStore(store).getAll();
  await tx.done;
  return {data:parseDataset(data),revision:meta.revision};
}
export async function initialized(db:IDBPDatabase){return (await db.get('workspaceMeta','active'))!==undefined;}
export async function putSale(db:IDBPDatabase,sale:Sale,expectedRevision:number,mode:'add'|'edit'){
  const tx=db.transaction(['workspaceMeta','sales'],'readwrite');
  try{
    const meta=await tx.objectStore('workspaceMeta').get('active');
    if(!meta||meta.revision!==expectedRevision)throw new StoreError('STALE','다른 화면에서 기록이 변경되었습니다. 창을 닫고 최신 기록을 다시 확인해 주세요.');
    const existing=await tx.objectStore('sales').get(sale.sale_id);
    if(mode==='edit'&&!existing)throw new StoreError('MISSING','정정할 판매가 없습니다. 최신 목록을 확인해 주세요.');
    if(mode==='add'&&existing)throw new StoreError('DUPLICATE','이미 저장된 판매입니다.');
    const duplicate=await tx.objectStore('sales').index('group').get([sale.date,sale.menu_id,sale.channel]);
    if(duplicate&&duplicate.sale_id!==sale.sale_id)throw new StoreError('DUPLICATE','같은 일자·메뉴·채널의 집계가 있습니다. 기존 기록의 수정 버튼을 이용해 주세요.');
    if(mode==='add')await tx.objectStore('sales').add(sale);else await tx.objectStore('sales').put(sale);
    await tx.objectStore('workspaceMeta').put({...meta,revision:meta.revision+1},'active');
    await tx.done;
  }catch(e){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw e;}
}
export async function removeSale(db:IDBPDatabase,saleId:string,expectedRevision:number){
  const tx=db.transaction(['workspaceMeta','sales'],'readwrite');
  try{
    const meta=await tx.objectStore('workspaceMeta').get('active');
    if(!meta||meta.revision!==expectedRevision)throw new StoreError('STALE','기록이 변경되었습니다. 최신 목록을 다시 확인해 주세요.');
    if(!await tx.objectStore('sales').get(saleId))throw new StoreError('MISSING','삭제할 판매가 없습니다.');
    await tx.objectStore('sales').delete(saleId);await tx.objectStore('workspaceMeta').put({...meta,revision:meta.revision+1},'active');await tx.done;
  }catch(e){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw e;}
}
export function errorMessage(error:unknown){
  if(error instanceof DOMException&&error.name==='QuotaExceededError')return '브라우저 저장 공간이 부족합니다. 기록을 적용하지 않았습니다. 입력 내용을 유지한 채 공간을 확인해 주세요.';
  if(error instanceof DOMException&&error.name==='ConstraintError')return '중복 기록이 있어 저장하지 않았습니다. 기존 기록을 확인해 주세요.';
  if(error instanceof DOMException&&error.name==='SecurityError')return '브라우저 저장소가 차단되었습니다. 지정한 일반 브라우저에서 저장 권한을 확인해 주세요.';
  return error instanceof Error?error.message:'저장하지 못했습니다. 기존 자료를 유지했습니다.';
}
