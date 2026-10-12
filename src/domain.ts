import Decimal from 'decimal.js';
import { z } from 'zod';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });
export type Money = string | null;
const dateString = z.string().refine(validDate, '유효한 날짜를 입력해 주세요.');
const nonnegative = z.number().finite().nonnegative();
const positive = z.number().finite().positive();
const unit = z.enum(['g', 'ml', '개']);
const optionalMoney = z.union([nonnegative, z.string().refine(validAmount), z.null()]).optional();
const id = z.string().min(1);
const menuSchema = z.object({menu_id:id,name:id,price:nonnegative,category:id,recipe_version:id});
const materialSchema = z.object({material_id:id,name:id,unit,pack_quantity:positive,base_pack_price:nonnegative,lead_days:nonnegative,safety_days:nonnegative,supplier_id:id});
const recipeSchema = z.object({recipe_version:id,menu_id:id,material_id:id,quantity:positive,unit,channel_only:z.enum(['매장','포장']).optional()});
const saleSchema = z.object({sale_id:id,date:dateString,menu_id:id,channel:z.enum(['매장','포장']),quantity:positive.int().safe(),unit_price:z.union([nonnegative,z.string().refine(validAmount)]),discount_amount:z.union([nonnegative,z.string().refine(validAmount)]),net_sales:z.union([nonnegative,z.string().refine(validAmount)]),payment_fee:optionalMoney,recipe_version:id,unit_food_cost_snapshot:optionalMoney,unit_packaging_cost_snapshot:optionalMoney,cost_basis:z.string().optional()});
const rawSchema = z.object({
  meta:z.object({store_name:id,start_date:dateString,as_of:dateString,currency:z.literal('KRW'),dataset_id:id}).passthrough(),
  settings:z.record(z.string(),z.unknown()),
  suppliers:z.array(z.object({supplier_id:id,name:id}).passthrough()),
  materials:z.array(materialSchema),menus:z.array(menuSchema),recipes:z.array(recipeSchema),
  price_history:z.array(z.object({material_id:id,effective_date:dateString,pack_price:nonnegative,pack_quantity:positive})),
  calendar:z.array(z.object({date:dateString,is_open:z.boolean(),record_complete:z.boolean(),weather:z.string(),note:z.string()})),
  sales:z.array(saleSchema),
  opening_inventory:z.array(z.object({material_id:id,date:dateString,quantity:nonnegative,unit})),
  inventory_events:z.array(z.object({event_id:id,date:dateString,material_id:id,event_type:z.enum(['입고','폐기','실사조정']),quantity:z.number().finite(),unit,reason:z.string(),unit_cost:nonnegative.optional(),supplier_id:id.optional(),counted_quantity:nonnegative.optional()})),
  expenses:z.array(z.object({expense_id:id,date:dateString,category:id,amount:nonnegative,recognition:z.string()})),
  monthly_expense_plan:z.array(z.object({month:z.string().regex(/^\d{4}-\d{2}$/),category:id,amount:nonnegative})),
});
type Raw = z.infer<typeof rawSchema>;
export type Menu = Raw['menus'][number];
export type Sale = Omit<Raw['sales'][number], 'unit_price'|'discount_amount'|'net_sales'|'payment_fee'|'unit_food_cost_snapshot'|'unit_packaging_cost_snapshot'> & {
  unit_price:string;discount_amount:string;net_sales:string;payment_fee:Money;unit_food_cost_snapshot:Money;unit_packaging_cost_snapshot:Money;
};
export type Dataset = Omit<Raw,'sales'> & {sales:Sale[]};
export type Period = {start:string;end:string};
export type Draft = {date:string;menu_id:string;channel:'매장'|'포장';quantity:string;unit_price:string;discount_amount:string;food:string;packaging:string;fee:string};

export function validDate(value:string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===value;
}
export function validAmount(value:string) {
  return /^\d+(\.\d+)?$/.test(value) && value.replace('.','').length<=28 && new Decimal(value).isFinite();
}
const normalizeMoney = (v:unknown):Money => v===null||v===undefined ? null : new Decimal(String(v)).toString();
export function parseDataset(input:unknown):Dataset {
  const parsed=rawSchema.safeParse(input);
  if (!parsed.success) throw new Error('자료 형식 오류: '+parsed.error.issues.slice(0,3).map(x=>`${x.path.join('.')} (${x.message})`).join(' / '));
  const data=parsed.data;
  const unique=(values:string[],label:string)=>{if(new Set(values).size!==values.length)throw new Error(`${label} 중복 기록이 있습니다.`);};
  unique(data.menus.map(x=>x.menu_id),'메뉴ID'); unique(data.materials.map(x=>x.material_id),'재료ID');
  unique(data.suppliers.map(x=>x.supplier_id),'공급사ID'); unique(data.sales.map(x=>x.sale_id),'판매ID');
  unique(data.sales.map(saleKey),'일자·메뉴·채널'); unique(data.inventory_events.map(x=>x.event_id),'재고ID');
  unique(data.expenses.map(x=>x.expense_id),'비용ID'); unique(data.calendar.map(x=>x.date),'영업일자');
  unique(data.price_history.map(x=>`${x.material_id}|${x.effective_date}`),'재료 가격 적용일');
  unique(data.opening_inventory.map(x=>x.material_id),'초기재고 재료');
  unique(data.recipes.map(x=>`${x.menu_id}|${x.recipe_version}|${x.material_id}|${x.channel_only??''}`),'레시피');
  const menus=new Set(data.menus.map(x=>x.menu_id));const materials=new Map(data.materials.map(x=>[x.material_id,x]));const suppliers=new Set(data.suppliers.map(x=>x.supplier_id));
  for(const m of data.materials)if(!suppliers.has(m.supplier_id))throw new Error(`${m.material_id}: 연결할 공급사가 없습니다.`);
  for(const r of data.recipes)if(!menus.has(r.menu_id)||materials.get(r.material_id)?.unit!==r.unit)throw new Error(`레시피 연결·단위 오류: ${r.menu_id}/${r.material_id}`);
  for(const p of data.price_history)if(!materials.has(p.material_id))throw new Error(`가격 연결 오류: ${p.material_id}`);
  for(const r of [...data.opening_inventory,...data.inventory_events])if(materials.get(r.material_id)?.unit!==r.unit)throw new Error(`재고 연결·단위 오류: ${r.material_id}`);
  for(const e of data.inventory_events)if((e.event_type==='입고'&&e.quantity<=0)||(e.event_type==='폐기'&&e.quantity>=0))throw new Error(`재고 부호 오류: ${e.event_id}`);
  for(const s of data.sales)if(!menus.has(s.menu_id)||!data.recipes.some(r=>r.menu_id===s.menu_id&&r.recipe_version===s.recipe_version))throw new Error(`판매 레시피 연결 오류: ${s.sale_id}`);
  return {...data,sales:data.sales.map(s=>({...s,unit_price:normalizeMoney(s.unit_price)!,discount_amount:normalizeMoney(s.discount_amount)!,net_sales:normalizeMoney(s.net_sales)!,payment_fee:normalizeMoney(s.payment_fee),unit_food_cost_snapshot:normalizeMoney(s.unit_food_cost_snapshot),unit_packaging_cost_snapshot:normalizeMoney(s.unit_packaging_cost_snapshot)}))};
}
export function saleKey(s:Pick<Sale,'date'|'menu_id'|'channel'>) {return `${s.date}|${s.menu_id}|${s.channel}`;}
export function costDefaults(data:Dataset,menuId:string,date:string,channel:Sale['channel']) {
  const menu=data.menus.find(m=>m.menu_id===menuId);
  const rows=data.recipes.filter(r=>r.menu_id===menuId&&r.recipe_version===menu?.recipe_version&&(!r.channel_only||r.channel_only===channel));
  if(!menu||!rows.length)return {food:null as Money,packaging:null as Money,recipeVersion:menu?.recipe_version??'',issues:['등록된 레시피를 찾을 수 없습니다.']};
  let food=new Decimal(0),pack=new Decimal(0);let foodMissing=false,packMissing=false;const issues:string[]=[];
  for(const r of rows){
    const matches=data.price_history.filter(p=>p.material_id===r.material_id&&p.effective_date<=date).sort((a,b)=>b.effective_date.localeCompare(a.effective_date));
    const material=data.materials.find(m=>m.material_id===r.material_id);const price=matches[0];const isPack=r.channel_only==='포장';
    if(!price||price.pack_quantity<=0||material?.unit!==r.unit||(matches[1]?.effective_date===price.effective_date)){
      issues.push(`${material?.name??r.material_id}: 판매일의 가격·단위를 확인해 주세요.`);if(isPack)packMissing=true;else foodMissing=true;continue;
    }
    const amount=new Decimal(String(price.pack_price)).div(String(price.pack_quantity)).mul(String(r.quantity));
    if(isPack)pack=pack.add(amount);else food=food.add(amount);
  }
  return {food:foodMissing?null:food.toString(),packaging:packMissing?null:pack.toString(),recipeVersion:menu.recipe_version,issues};
}
export const roundWon=(v:Decimal.Value)=>new Decimal(v).toDecimalPlaces(0,Decimal.ROUND_HALF_UP).toString();
export function saleAmounts(s:Sale){
  const food=s.unit_food_cost_snapshot===null?null:roundWon(new Decimal(s.unit_food_cost_snapshot).mul(s.quantity));
  const packaging=s.unit_packaging_cost_snapshot===null?null:roundWon(new Decimal(s.unit_packaging_cost_snapshot).mul(s.quantity));
  const direct=food===null||packaging===null||s.payment_fee===null?null:new Decimal(food).add(packaging).add(s.payment_fee).toString();
  const profit=direct===null?null:new Decimal(s.net_sales).sub(direct).toString();
  const rate=profit===null||new Decimal(s.net_sales).isZero()?null:new Decimal(profit).div(s.net_sales).mul(100).toDecimalPlaces(1).toString();
  const issues:string[]=[];if(food===null)issues.push('식재료 원가 미확인');if(packaging===null)issues.push('포장 원가 미확인');if(s.payment_fee===null)issues.push('수수료 미확인');
  const expected=new Decimal(s.unit_price).mul(s.quantity).sub(s.discount_amount);
  if(!expected.equals(s.net_sales))issues.push('기록 순매출과 계산값 차이: 원본 정정 필요');
  return {food,packaging,direct,profit,rate,issues};
}
export function validatePeriod(p:Period){if(!validDate(p.start)||!validDate(p.end))return '시작일과 종료일을 정확히 입력해 주세요.';if(p.start>p.end)return '시작일은 종료일보다 늦을 수 없습니다.';return null;}
export function filterSales(data:Dataset,p:Period,menuId='',channel=''){return data.sales.filter(s=>s.date>=p.start&&s.date<=p.end&&(!menuId||s.menu_id===menuId)&&(!channel||s.channel===channel));}
export function periodState(data:Dataset,p:Period){
  const rows=data.calendar.filter(d=>d.date>=p.start&&d.date<=p.end);
  const expected=(Date.parse(`${p.end}T00:00:00Z`)-Date.parse(`${p.start}T00:00:00Z`))/86400000+1;
  const unclosed=rows.filter(d=>!d.record_complete).length;const unknown=Math.max(0,expected-rows.length);
  return {closed:rows.filter(d=>d.record_complete).length,unclosed,unknown,openClosed:rows.filter(d=>d.record_complete&&d.is_open).length,partial:unclosed>0||unknown>0};
}
export function validateDraft(data:Dataset,d:Draft):Record<string,string>{
  const errors:Record<string,string>={};
  if(!validDate(d.date))errors.date='유효한 판매일자를 입력해 주세요.';else if(d.date<data.meta.start_date)errors.date='초기재고 기준일 이전 판매는 추가할 수 없습니다.';
  if(!data.menus.some(m=>m.menu_id===d.menu_id))errors.menu_id='등록된 메뉴를 선택해 주세요.';
  if(!['매장','포장'].includes(d.channel))errors.channel='판매채널을 선택해 주세요.';
  if(!/^\d+$/.test(d.quantity)||!Number.isSafeInteger(Number(d.quantity))||Number(d.quantity)<=0)errors.quantity='수량은 1 이상의 정수여야 합니다.';
  for(const [key,label] of [['unit_price','단가'],['discount_amount','총 할인액']] as const)if(!validAmount(d[key]))errors[key]=`${label}은 0 이상의 금액으로 입력해 주세요.`;
  for(const [key,label] of [['food','개당 식재료 원가'],['packaging','개당 포장 원가'],['fee','총 결제수수료']] as const)if(d[key]!==''&&!validAmount(d[key]))errors[key]=`${label}은 빈칸 또는 0 이상의 금액이어야 합니다.`;
  if(!errors.quantity&&!errors.unit_price&&!errors.discount_amount&&new Decimal(d.discount_amount).gt(new Decimal(d.unit_price).mul(d.quantity)))errors.discount_amount='총 할인액은 수량 × 단가를 넘을 수 없습니다.';
  return errors;
}
export function makeSale(data:Dataset,d:Draft,existing?:Sale):Sale{
  const errors=validateDraft(data,d);if(Object.keys(errors).length)throw new Error(Object.values(errors).join(' '));
  const sameBasis=existing&&existing.date===d.date&&existing.menu_id===d.menu_id&&existing.channel===d.channel;
  return {sale_id:existing?.sale_id??crypto.randomUUID(),date:d.date,menu_id:d.menu_id,channel:d.channel,quantity:Number(d.quantity),unit_price:normalizeMoney(d.unit_price)!,discount_amount:normalizeMoney(d.discount_amount)!,net_sales:new Decimal(d.quantity).mul(d.unit_price).sub(d.discount_amount).toString(),payment_fee:d.fee===''?null:normalizeMoney(d.fee),unit_food_cost_snapshot:d.food===''?null:normalizeMoney(d.food),unit_packaging_cost_snapshot:d.packaging===''?null:normalizeMoney(d.packaging),recipe_version:sameBasis?existing.recipe_version:data.menus.find(m=>m.menu_id===d.menu_id)!.recipe_version,cost_basis:existing?.cost_basis??'등록 레시피·판매일 가격 참고 / 운영자 확인'};
}
export function aggregate(sales:Sale[]){
  const sum=(values:Money[]):Money=>values.some(v=>v===null)?null:values.reduce<Decimal>((a,v)=>a.add(v!),new Decimal(0)).toString();
  const amounts=sales.map(saleAmounts);const net=sum(sales.map(s=>s.net_sales))!;
  const food=sum(amounts.map(a=>a.food)),packaging=sum(amounts.map(a=>a.packaging)),fee=sum(sales.map(s=>s.payment_fee)),profit=sum(amounts.map(a=>a.profit));
  const quantity=sales.reduce((a,s)=>a+s.quantity,0);
  const gross=sum(sales.map(s=>new Decimal(s.unit_price).mul(s.quantity).toString()))!;
  return {count:sales.length,quantity,net,food,packaging,fee,profit,missing:amounts.filter(a=>a.issues.length).length,rate:profit===null||new Decimal(net).isZero()?null:new Decimal(profit).div(net).mul(100).toDecimalPlaces(1).toString(),averagePrice:quantity?new Decimal(gross).div(quantity).toDecimalPlaces(2).toString():null};
}
export function menuSummaries(data:Dataset,sales:Sale[]){return data.menus.map(menu=>({menu,...aggregate(sales.filter(s=>s.menu_id===menu.menu_id))}));}
// EPIC 1 판매 정정·삭제의 재료 영향 검증용 공통 계산. 재료 화면은 EPIC 2에서 구현한다.
export function inventoryAt(data:Dataset,end:string){
  const result=new Map(data.opening_inventory.map(i=>[i.material_id,new Decimal(String(i.quantity))]));
  for(const e of data.inventory_events)if(e.date<=end&&e.date>=data.meta.start_date)result.set(e.material_id,result.get(e.material_id)!.add(String(e.quantity)));
  for(const s of data.sales)if(s.date<=end&&s.date>=data.meta.start_date){
    const rows=data.recipes.filter(r=>r.menu_id===s.menu_id&&r.recipe_version===s.recipe_version&&(!r.channel_only||r.channel_only===s.channel));
    if(!rows.length)throw new Error('레시피가 없어 재료 사용량을 확인할 수 없습니다.');
    for(const r of rows){if(!result.has(r.material_id))throw new Error('초기재고가 없어 잔량을 확인할 수 없습니다.');result.set(r.material_id,result.get(r.material_id)!.sub(new Decimal(String(r.quantity)).mul(s.quantity)));}
  }
  return Object.fromEntries([...result].map(([key,value])=>[key,value.toString()]));
}
export function won(value:Money){if(value===null)return '미확인';const [whole,fraction]=new Decimal(value).toDecimalPlaces(2).toString().split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?`.${fraction}`:'');}
