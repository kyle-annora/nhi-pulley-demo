import {jsPDF} from 'jspdf';
import {money,FINISHES,openItems} from './domain.mjs';
import {quoteOpenItems} from './journey.mjs';
import {explorerEvidenceText} from './explorer-evidence.mjs';

const latin=s=>String(s??'').replace(/[–—]/g,'-').replace(/[’‘]/g,"'").replace(/[“”″]/g,'"').replace(/\u2026/g,'...').replace(/\u2022/g,'-');
export function makeQuotePDF(q,logo){
  if(!q)throw new Error('Open a saved example quote first.');
  if(/[^\x09\x0a\x0d\x20-\xff]/.test(latin(JSON.stringify(q.requirements))))throw new Error('PDF supports Latin-script text in this demo. Export the case JSON to retain all original characters.');
  const pdf=new jsPDF({unit:'mm',format:'a4',compress:true});
  pdf.setProperties({title:`${q.id} - Example quote - Not an NHI offer`,subject:`Local demonstration for ${q.rfqId}`,author:'NHI demonstration by Annora',creator:'NHI pulley demonstration'});
  const ink=[32,38,34],muted=[99,111,91],green=[61,100,39],line=[218,224,213];let y=18;
  function font(size=9,bold=false,color=ink){pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(...color);}
  function rule(yLine=y){pdf.setDrawColor(...line);pdf.setLineWidth(.2);pdf.line(18,yLine,192,yLine);}
  function banner(){pdf.setFillColor(247,244,233);pdf.rect(18,12,174,9,'F');font(8,true,[113,94,47]);pdf.text('EXAMPLE QUOTE - NOT AN NHI OFFER',22,18);}
  function nextPage(){pdf.addPage();banner();y=30;font(10,true);pdf.text(`${q.id} - continuation`,18,y);y+=10;}
  function need(height){if(y+height>273)nextPage();}
  function paragraph(title,text){font(9,false,muted);const lines=pdf.splitTextToSize(latin(text),174);need(12+lines.length*4.4);font(9.5,true);pdf.text(title,18,y);y+=6;font(9,false,muted);pdf.text(lines,18,y);y+=lines.length*4.4+7;}
  banner();
  if(logo)pdf.addImage(logo,'PNG',18,29,83.6,10);else{font(27,true);pdf.text('NHI',18,39);}
  font(10,true);pdf.text('QUOTATION',192,33,{align:'right'});font(8,false,muted);pdf.text(`${q.id} / v${q.version}`,192,39,{align:'right'});y=46;rule();
  y=55;font(7,true,muted);pdf.text('PREPARED FOR',18,y);font(13,true);const companyLines=pdf.splitTextToSize(latin(q.requirements.company),95);pdf.text(companyLines,18,y+7);const identityY=y+7+companyLines.length*5.3;font(9,false,muted);pdf.text(latin(q.requirements.name),18,identityY+2);const emailLines=pdf.splitTextToSize(latin(q.requirements.email),95);pdf.text(emailLines,18,identityY+7);
  font(8,false,muted);pdf.text('RFQ reference',124,y);pdf.text('Example date',124,y+8);font(8);pdf.text(`${q.rfqId} / v${q.rfqVersion}`,192,y,{align:'right'});pdf.text(new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'America/Los_Angeles'}).format(new Date(q.createdAt)),192,y+8,{align:'right'});
  y=Math.max(83,identityY+emailLines.length*4.4+17);
  font(9);const applicationLines=pdf.splitTextToSize(latin(q.requirements.application),164);const scopeH=24+applicationLines.length*4.2;need(scopeH+10);pdf.setFillColor(242,245,239);pdf.rect(18,y-5,174,scopeH,'F');font(12,true);pdf.text(q.product.id,23,y+2);font(9,false,muted);pdf.text('A Series / Double-flange flat idler',53,y+2);font(9,false,muted);pdf.text(applicationLines,23,y+10);font(8);pdf.text(`Outside diameter ${q.product.odLabel}"   |   Belt-running diameter ${q.product.flatLabel}"   |   Width ${q.product.widthLabel}"`,23,y+15+applicationLines.length*4.2);y+=scopeH+3;
  function tableHeader(){need(18);rule();font(7.5,true,muted);pdf.text('ITEM & SCOPE',18,y+6);pdf.text('QTY',122,y+6,{align:'right'});pdf.text('UNIT PRICE',156,y+6,{align:'right'});pdf.text('AMOUNT',192,y+6,{align:'right'});y+=10;rule();}
  tableHeader();
  for(const l of q.lines){font(9);const texts=pdf.splitTextToSize(latin(l.label),88),height=Math.max(10.5,texts.length*4.4+5);if(y+height>270){nextPage();tableHeader();}font(9,false,l.unitCents===null?muted:ink);pdf.text(texts,18,y+6);font(8.5,false,l.unitCents===null?muted:ink);pdf.text(l.qty.toLocaleString('en-US'),122,y+6,{align:'right'});pdf.text(l.unitCents===null?'Pending':money(l.unitCents),156,y+6,{align:'right'});pdf.text(l.unitCents===null?'Pending':money(l.qty*l.unitCents),192,y+6,{align:'right'});y+=height;rule();}
  need(30);y+=9;font(9);pdf.text('Priced subtotal (USD)',119,y);font(15,true);pdf.text(money(q.totals.subtotalCents),192,y,{align:'right'});y+=7;font(9,false,muted);pdf.text('Final total',119,y);pdf.text(q.totals.totalCents===null?'Pending review':money(q.totals.totalCents),192,y,{align:'right'});y+=7;font(8,false,muted);pdf.text('Unpriced items are excluded from the subtotal; they are not treated as zero.',18,y);y+=12;
  const technical=`Base part in standard iron phosphate. Requested finish: ${FINISHES[q.requirements.finish]}. Mounting: ${q.requirements.mounting}. ${quoteOpenItems(q).join(' ')}`;
  const commercial=`Requested window: ${q.requirements.timing}. Example lead time: ${q.lead}. ${q.terms} ${q.validity}`;
  font(8,false,muted);const left=pdf.splitTextToSize(latin(technical),82),right=pdf.splitTextToSize(latin(commercial),82);const height=10+Math.max(left.length,right.length)*3.6;need(height);rule(y-4);font(9,true);pdf.text('Scope & technical conditions',18,y+2);pdf.text('Example commercial terms',110,y+2);font(8,false,muted);pdf.text(left,18,y+8,{lineHeightFactor:1.27});pdf.text(right,110,y+8,{lineHeightFactor:1.27});y+=height+3;
  if(q.requirements.notes)paragraph('Customer notes',q.requirements.notes);
  if(q.responseId)paragraph('Revised example - traceability',`Version ${q.version}, following ${q.revisionId} and simulated reply ${q.responseId}. Previous version ${q.previousVersion} is preserved. The customer requested ${q.requirements.timing}; the planning alternative is ${q.lead}. Requested timing is not confirmed. Technical release, freight and tax remain pending.`);
  if(q.requirements.explorerRequirements?.length)paragraph('Customer inputs from Explorer',q.requirements.explorerRequirements.map(r=>explorerEvidenceText(r)+(r.note?' '+r.note:'')).join(' '));
  const disclaimer=`Request a revision against ${q.id} / v${q.version} in the demo workspace. All prices and terms are illustrative. This is not an NHI offer, confirms neither fit nor availability, and cannot be used to place an order.`;
  font(7,false,muted);const endLines=pdf.splitTextToSize(disclaimer,174);need(endLines.length*3.2+4);pdf.text(endLines,18,y,{lineHeightFactor:1.3});
  for(let page=1;page<=pdf.getNumberOfPages();page++){pdf.setPage(page);rule(280);font(7,false,muted);pdf.text('NHI pulley experience by Annora | All commercial data is illustrative',18,286);pdf.text(`${page} / ${pdf.getNumberOfPages()}`,192,286,{align:'right'});}
  return pdf;
}
