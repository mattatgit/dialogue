import { el } from './build-ui.mjs';

// Keep existing gallery loading/rendering as the source of truth for emptiness.
// Both the current local modal workflow and the earlier page workflow use these
// same regions; enhance them without changing their data or creation handlers.
const definitions=[
  {kind:'projects',selector:'[data-project-empty]',attribute:'data-project-empty',label:'No projects',image:'projects',size:176,createLabel:'Create a project',hideTitle:true},
  {kind:'builds',selector:'[data-build-empty]',attribute:'data-build-empty',label:'No builds',image:'builds',size:180,createLabel:'Create a build'},
  {kind:'design-systems',selector:'.empty-state',label:'No design systems',image:'design-systems',size:176,hideTitle:true}
];

for(const definition of definitions){
  const previous=document.querySelector(definition.selector);
  if(!previous)continue;
  const main=previous.closest('main'),header=main.querySelector('.page-head'),heading=header.querySelector('h1');
  const create=header.querySelector('a[href="#new-project"]'),importAction=header.querySelector('a[href*="import.html"]');
  const primary=create || header.querySelector('button'),primaryLabel=primary?.textContent;
  if(create)create.setAttribute('aria-label',primaryLabel);
  const region=el('section','','gallery-empty-state');region.dataset.emptyKind=definition.kind;
  if(definition.attribute)region.setAttribute(definition.attribute,'');
  region.hidden=previous.hidden;region.setAttribute('aria-label',definition.label);region.setAttribute('aria-live','polite');
  const figure=el(create?'a':'div','','gallery-empty-figure'),image=el('img','','gallery-empty-illustration');
  image.src=`assets/empty-states/${definition.image}.png`;image.width=image.height=definition.size;image.alt='';
  image.loading='lazy';
  figure.append(image);
  const openCreate=event=>{event.preventDefault();create.click();};
  if(create){figure.href=create.getAttribute('href');figure.setAttribute('aria-label',definition.createLabel);figure.addEventListener('click',openCreate);}
  const copy=el('p','','gallery-empty-copy');
  const link=(text,href)=>{const action=el('a',text);action.href=href;return action;};
  const createLink=text=>{const action=link(text,create.getAttribute('href'));action.addEventListener('click',openCreate);return action;};
  let inlineImport;
  if(definition.kind==='projects')copy.append(createLink('Click to create a new Dialogue project'));
  else if(definition.kind==='builds'){
    copy.append(el('span','This project doesn’t have any builds yet.'));
    const line=el('span');inlineImport=link('import something.',importAction.getAttribute('href'));
    line.append(createLink('Create something new'),document.createTextNode(' or '),inlineImport);copy.append(line);
  }else copy.textContent='Click import to add a design system to Dialogue';
  region.append(figure,copy);previous.replaceWith(region);
  header.querySelector('.flow-actions')?.classList.add('gallery-empty-actions');
  if(!create)primary?.classList.add('gallery-empty-actions');

  // The empty view has one Create action. Preserve the existing import entry
  // inside the create form, including the local build's import-dialog handler.
  let alternative;
  if(create && importAction){
    const form=document.querySelector(definition.kind==='projects'?'[data-project-create]':'[data-build-create]');
    alternative=link(definition.kind==='projects'?'Import an existing project instead':'Import an existing build instead',importAction.getAttribute('href'));
    alternative.className='gallery-empty-import-alternative';alternative.dataset.emptyImportAlternative='';form.append(alternative);
    alternative.addEventListener('click',()=>{form.closest('.modal-layer')?.querySelector('.modal-close')?.click();create.focus({preventScroll:true});});
  }
  if(!create && primary?.disabled){
    const explanation=el('span',primary.title,'sr-only');explanation.id='design-system-import-unavailable';region.append(explanation);primary.setAttribute('aria-describedby',explanation.id);
  }
  const update=()=>{
    const empty=!region.hidden;
    main.classList.toggle('has-gallery-empty-state',empty);
    if(definition.hideTitle)heading?.classList.toggle('sr-only',empty);
    if(primary){primary.classList.toggle('gallery-empty-primary',empty);primary.textContent=empty && create?'Create':primaryLabel;}
    if(importAction){importAction.hidden=empty;for(const action of [alternative,inlineImport])if(action)action.href=importAction.href;}
  };
  new MutationObserver(update).observe(region,{attributes:true,attributeFilter:['hidden']});update();
}
