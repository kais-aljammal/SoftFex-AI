const action = document.getElementById('preview-action');
const island = document.getElementById('island');
const status = document.getElementById('island-status');
const label = document.getElementById('finding-label');
const title = document.getElementById('finding-title');
const description = document.getElementById('finding-description');
const denominator = document.getElementById('denominator');
const highlight = document.getElementById('highlight');
const codeState = document.getElementById('code-state');
const examples = [
  {state:'finding',status:'Potential issue',label:'Correctness · example finding',title:'Your average is a little off.',description:'Dividing by one fewer item returns the wrong result.',denominator:'(values.length - 1)',code:'Changes ready for review',action:'See the correction'},
  {state:'corrected',status:'Source updated',label:'Correction · example code',title:'One small correction.',description:'Codex changes the divisor to the actual number of items.',denominator:'values.length',code:'Correction ready for re-review',action:'See the re-review'},
  {state:'fixed',status:'Re-review complete',label:'Re-review · example result',title:'Issue no longer detected.',description:'The corrected scope was reviewed. This is not a whole-project guarantee.',denominator:'values.length',code:'Reviewed code · no finding',action:'Restart the preview'}
];
let step = 0;
document.getElementById('setup-link').addEventListener('click', (event) => {
  event.preventDefault();
  const details = document.getElementById('setup-details');
  details.open = true;
  details.querySelector('summary').focus({preventScroll:true});
  details.scrollIntoView({block:'start'});
});
action.addEventListener('click', () => {
  step = (step + 1) % examples.length;
  const example = examples[step];
  island.dataset.state = example.state;
  status.replaceChildren(Object.assign(document.createElement('i'), {ariaHidden:'true'}), document.createTextNode(example.status));
  label.textContent = example.label;
  title.textContent = example.title;
  description.textContent = example.description;
  denominator.textContent = example.denominator;
  codeState.textContent = example.code;
  highlight.className = `highlight ${example.state === 'finding' ? '' : example.state}`;
  action.replaceChildren(document.createTextNode(`${example.action} `), Object.assign(document.createElement('span'), {textContent:'↗',ariaHidden:'true'}));
});
