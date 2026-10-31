/* Touch editor adapter. Project text stays in the existing persistence model. */
import {EditorState, Compartment} from '@codemirror/state';
import {EditorView, keymap, lineNumbers, highlightActiveLineGutter, drawSelection} from '@codemirror/view';
import {history, undo, redo, undoDepth, redoDepth, defaultKeymap, historyKeymap, indentWithTab, indentMore, cursorCharLeft, cursorCharRight} from '@codemirror/commands';
import {syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput, indentUnit} from '@codemirror/language';
import {autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, startCompletion} from '@codemirror/autocomplete';
import {javascript} from '@codemirror/lang-javascript';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {json} from '@codemirror/lang-json';
import {python} from '@codemirror/lang-python';
import {markdown} from '@codemirror/lang-markdown';
import {oneDark} from '@codemirror/theme-one-dark';

function language(path) {
  const extension=path?.split('.').pop()?.toLowerCase();
  if (['js','mjs','cjs','jsx','ts','tsx'].includes(extension)) return javascript({jsx:extension.endsWith('x'),typescript:extension.startsWith('ts')});
  return ({html,htm:html,css,json,py:python,md:markdown})[extension]?.()||[];
}
window.VynqodePhoneEditor={create({parent,onChange,onSelection,onHistory}) {
  const states=new Map(),scrolls=new Map(),style=new Compartment();
  let current=null,session=null,settings={fontSize:16,wordWrap:true},view=null;
  const theme=()=>[EditorView.theme({
    '&':{height:'100%',fontSize:settings.fontSize+'px',backgroundColor:'#191a1e'},
    '.cm-scroller':{overflow:'auto',fontFamily:'ui-monospace, SFMono-Regular, Consolas, monospace',lineHeight:'1.6'},
    '.cm-content':{padding:'12px 0',minHeight:'100%',caretColor:'#f4b584'},
    '.cm-line':{padding:'0 12px 0 6px'},
    '.cm-gutters':{backgroundColor:'#191a1e',border:'none',color:'#767e8e'},
    '.cm-activeLineGutter':{backgroundColor:'#252931'},
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'#41536d'},
    '.cm-tooltip-autocomplete':{maxWidth:'90vw',fontSize:'14px'},
    '.cm-tooltip-autocomplete ul li':{padding:'10px 12px',minHeight:'48px'}
  }),settings.wordWrap?EditorView.lineWrapping:[]];
  function makeState(text,path,selection={anchor:0,head:0}) {
    const clamp=value=>Math.min(text.length,Math.max(0,value||0));
    return EditorState.create({doc:text,selection:{anchor:clamp(selection.anchor),head:clamp(selection.head)},extensions:[
      lineNumbers(),highlightActiveLineGutter(),history({minDepth:100}),drawSelection(),
      indentOnInput(),bracketMatching(),closeBrackets(),indentUnit.of('  '),
      EditorState.readOnly.of(!path),EditorView.editable.of(Boolean(path)),syntaxHighlighting(defaultHighlightStyle,{fallback:true}),language(path),oneDark,style.of(theme()),
      autocompletion({activateOnTyping:true,maxRenderedOptions:8,icons:false}),
      keymap.of([...closeBracketsKeymap,...defaultKeymap,...historyKeymap,...completionKeymap,indentWithTab]),
      EditorView.contentAttributes.of({'aria-label':'Source code editor',autocapitalize:'off',autocorrect:'off',spellcheck:'false'}),
      EditorView.updateListener.of(update=>{
        if(current)states.set(current,update.state);
        const selection=update.state.selection.main;
        if(update.docChanged)onChange(update.state.doc.toString(),selection.anchor,selection.head);
        if(update.selectionSet||update.docChanged)onSelection(selection.anchor,selection.head);
        onHistory?.(undoDepth(update.state)>0,redoDepth(update.state)>0);
      })
    ]});
  }
  view=new EditorView({parent,state:makeState('','')});
  return {
    sync(project,path,projectSession,position) {
      if(session!==projectSession){states.clear();scrolls.clear();session=projectSession;current=null;}
      if(current){states.set(current,view.state);scrolls.set(current,{top:view.scrollDOM.scrollTop,left:view.scrollDOM.scrollLeft});}
      for(const name of states.keys())if(!Object.hasOwn(project.files,name)){states.delete(name);scrolls.delete(name);}
      const text=path?project.files[path]||'':'';
      let state=states.get(path);
      if(!state||state.doc.toString()!==text)state=makeState(text,path,state?.selection.main||{anchor:position?.start,head:position?.end});
      current=path;view.setState(state);if(path)states.set(path,state);
      view.dispatch({effects:style.reconfigure(theme())});
      const scroll=scrolls.get(path)||position;view.scrollDOM.scrollTop=scroll?.top||0;view.scrollDOM.scrollLeft=scroll?.left||0;
      onHistory?.(undoDepth(view.state)>0,redoDepth(view.state)>0);
    },
    get scroll(){return {top:view.scrollDOM.scrollTop,left:view.scrollDOM.scrollLeft};},
    get text(){return view.state.doc.toString();},
    get selection(){const value=view.state.selection.main;return {start:Math.min(value.anchor,value.head),end:Math.max(value.anchor,value.head),anchor:value.anchor,head:value.head};},
    select(start,end=start,focus=true){const length=view.state.doc.length;view.dispatch({selection:{anchor:Math.min(start,length),head:Math.min(end,length)},scrollIntoView:true});if(focus)view.focus();},
    insert(text){if(!current)return;view.dispatch(view.state.replaceSelection(text),{scrollIntoView:true,userEvent:'input'});view.focus();},
    indent(){indentMore(view);view.focus();},
    move(direction){(direction<0?cursorCharLeft:cursorCharRight)(view);view.focus();},
    undo(){undo(view);view.focus();},redo(){redo(view);view.focus();},
    complete(){startCompletion(view);view.focus();},
    configure(value){settings=value;view.dispatch({effects:style.reconfigure(theme())});},
    focus(){view.focus();},
    get view(){return view;}
  };
}};
