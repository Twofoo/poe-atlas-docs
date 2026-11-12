import { useEffect, useRef, useState } from 'react';
import { backdrop } from '../ui.js';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { store } from '../store.js';
import { shareLink } from '../atlas/atlasModel.js';
import { tx } from '../i18n.js';

function Btn({ on, title, onClick, children, disabled }) {
  return (
    <button className={'tb' + (on ? ' on' : '')} title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export default function TextEditor({ doc, onChange, apiRef }) {
  const timer = useRef(0);
  const pending = useRef(null); // редактор с несохранёнными изменениями
  const cb = useRef(onChange);
  cb.current = onChange;
  const flush = () => {
    clearTimeout(timer.current);
    const ed = pending.current;
    pending.current = null;
    if (ed && !ed.isDestroyed) cb.current(ed.getJSON());
  };
  const [, rerender] = useState(0);
  const [treePicker, setTreePicker] = useState(null);
  const [linkDialog, setLinkDialog] = useState(null); // текущий адрес или null

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, protocols: ['poeatlas'] } }),
      Table.configure({ resizable: true }),
      TableRow, TableHeader, TableCell,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle, Color,
      Highlight.configure({ multicolor: true }),
    ],
    content: doc.content || '<h1>' + (doc.name || tx("Документ")) + '</h1><p></p>',
    onUpdate: ({ editor }) => {
      pending.current = editor;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 400);
    },
    onDestroy: () => flush(),
    onSelectionUpdate: () => rerender((x) => x + 1),
    onTransaction: () => rerender((x) => x + 1),
  }, [doc.id]);

  useEffect(() => {
    window.addEventListener('poe-flush-editors', flush);
    return () => { window.removeEventListener('poe-flush-editors', flush); flush(); };
  }, []);
  if (apiRef) apiRef.current = editor ? { getHTML: () => editor.getHTML() } : null;
  if (!editor) return null;
  const c = () => editor.chain().focus();
  const inTable = editor.isActive('table');

  const insertTreeLink = async () => setTreePicker(await store.list('trees'));
  const pickTree = async (meta) => {
    const t = await store.get('trees', meta.id);
    setTreePicker(null);
    if (!t) return;
    const href = shareLink(t, { withName: true });
    c().insertContent([{ type: 'text', text: '🗺 ' + t.name, marks: [{ type: 'link', attrs: { href } }] }, { type: 'text', text: ' ' }]).run();
  };
  // window.prompt() в Electron не поддерживается — свой диалог
  const savedSel = useRef(null);
  const setLink = () => {
    const { from, to } = editor.state.selection;
    savedSel.current = { from, to };
    setLinkDialog(editor.getAttributes('link').href || '');
  };
  const applyLink = (url) => {
    setLinkDialog(null);
    const sel = savedSel.current;
    let ch = editor.chain().focus();
    if (sel) ch = ch.setTextSelection(sel);
    if (editor.isActive('link') || (sel && sel.from === sel.to)) ch = ch.extendMarkRange('link');
    if (!url.trim()) ch.unsetLink().run();
    else if (sel && sel.from === sel.to && !editor.isActive('link')) {
      // ничего не выделено — вставляем адрес как текст ссылки
      ch.insertContent({ type: 'text', text: url.trim(), marks: [{ type: 'link', attrs: { href: url.trim() } }] }).run();
    } else ch.setLink({ href: url.trim() }).run();
  };

  return (
    <div className="text-editor">
      <div className="toolbar">
        <Btn title={tx("Отменить (Ctrl+Z)")} onClick={() => c().undo().run()}>↶</Btn>
        <Btn title={tx("Повторить (Ctrl+Y)")} onClick={() => c().redo().run()}>↷</Btn>
        <span className="sep" />
        <select
          className="tb-select"
          value={editor.isActive('heading', { level: 1 }) ? '1' : editor.isActive('heading', { level: 2 }) ? '2' : editor.isActive('heading', { level: 3 }) ? '3' : 'p'}
          onChange={(e) => { const v = e.target.value; if (v === 'p') c().setParagraph().run(); else c().toggleHeading({ level: Number(v) }).run(); }}
        >
          <option value="p">{tx("Обычный текст")}</option>
          <option value="1">{tx("Заголовок 1")}</option>
          <option value="2">{tx("Заголовок 2")}</option>
          <option value="3">{tx("Заголовок 3")}</option>
        </select>
        <Btn on={editor.isActive('bold')} title={tx("Жирный (Ctrl+B)")} onClick={() => c().toggleBold().run()}><b>{tx("Ж")}</b></Btn>
        <Btn on={editor.isActive('italic')} title={tx("Курсив (Ctrl+I)")} onClick={() => c().toggleItalic().run()}><i>{tx("К")}</i></Btn>
        <Btn on={editor.isActive('underline')} title={tx("Подчёркнутый (Ctrl+U)")} onClick={() => c().toggleUnderline().run()}><u>{tx("Ч")}</u></Btn>
        <Btn on={editor.isActive('strike')} title={tx("Зачёркнутый")} onClick={() => c().toggleStrike().run()}><s>{tx("З")}</s></Btn>
        <label className="tb color" title={tx("Цвет текста")}>
          A<input type="color" onChange={(e) => c().setColor(e.target.value).run()} />
        </label>
        <label className="tb color hl" title={tx("Выделение цветом")}>
          ▌<input type="color" defaultValue="#6b5a1e" onChange={(e) => c().toggleHighlight({ color: e.target.value }).run()} />
        </label>
        <span className="sep" />
        <Btn on={editor.isActive({ textAlign: 'left' })} title={tx("По левому краю")} onClick={() => c().setTextAlign('left').run()}>⯇</Btn>
        <Btn on={editor.isActive({ textAlign: 'center' })} title={tx("По центру")} onClick={() => c().setTextAlign('center').run()}>≡</Btn>
        <Btn on={editor.isActive({ textAlign: 'right' })} title={tx("По правому краю")} onClick={() => c().setTextAlign('right').run()}>⯈</Btn>
        <span className="sep" />
        <Btn on={editor.isActive('bulletList')} title={tx("Маркированный список")} onClick={() => c().toggleBulletList().run()}>• ≡</Btn>
        <Btn on={editor.isActive('orderedList')} title={tx("Нумерованный список")} onClick={() => c().toggleOrderedList().run()}>1.</Btn>
        <Btn on={editor.isActive('blockquote')} title={tx("Цитата")} onClick={() => c().toggleBlockquote().run()}>❝</Btn>
        <Btn on={editor.isActive('codeBlock')} title={tx("Код")} onClick={() => c().toggleCodeBlock().run()}>{'</>'}</Btn>
        <Btn title={tx("Горизонтальная линия")} onClick={() => c().setHorizontalRule().run()}>―</Btn>
        <Btn on={editor.isActive('link')} title={tx("Ссылка")} onClick={setLink}>🔗</Btn>
        <Btn title={tx("Вставить ссылку на дерево атласа")} onClick={insertTreeLink}>{tx("🗺 Дерево")}</Btn>
        <span className="sep" />
        <Btn title={tx("Вставить таблицу 3×3")} onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>{tx("▦ Таблица")}</Btn>
        {inTable && (
          <>
            <Btn title={tx("Строка ниже")} onClick={() => c().addRowAfter().run()}>{tx("+строка")}</Btn>
            <Btn title={tx("Столбец справа")} onClick={() => c().addColumnAfter().run()}>{tx("+столбец")}</Btn>
            <Btn title={tx("Удалить строку")} onClick={() => c().deleteRow().run()}>{tx("−строка")}</Btn>
            <Btn title={tx("Удалить столбец")} onClick={() => c().deleteColumn().run()}>{tx("−столбец")}</Btn>
            <Btn title={tx("Объединить/разъединить ячейки")} onClick={() => c().mergeOrSplit().run()}>⊞</Btn>
            <Btn title={tx("Удалить таблицу")} onClick={() => c().deleteTable().run()}>{tx("✕ табл.")}</Btn>
          </>
        )}
      </div>
      <div className="page-scroll">
        <div className="page">
          <EditorContent editor={editor} />
        </div>
      </div>
      {linkDialog !== null && (
        <div className="modal-back" {...backdrop(() => setLinkDialog(null))}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); applyLink(e.target.url.value); }}>
            <h3>{tx("Ссылка")}</h3>
            <label className="field"><span>{tx("Адрес (https://… или poeatlas://…). Пусто — убрать ссылку.")}</span>
              <input name="url" autoFocus defaultValue={linkDialog} />
            </label>
            <div className="row end">
              <button type="button" className="btn" onClick={() => setLinkDialog(null)}>{tx("Отмена")}</button>
              <button type="submit" className="btn primary">{tx("Применить")}</button>
            </div>
          </form>
        </div>
      )}
      {treePicker && (
        <div className="modal-back" {...backdrop(() => setTreePicker(null))}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{tx("Вставить ссылку на дерево")}</h3>
            {treePicker.length === 0 && <p className="muted">{tx("В библиотеке пока нет деревьев.")}</p>}
            {treePicker.map((t) => (
              <button key={t.id} className="variant-btn" onClick={() => pickTree(t)}>{t.name} <span className="muted">· {(t.nodes?.length || 1) - 1} {tx("очк.")}</span></button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function docToHtml(editorJsonHtml, title) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;font-size:11pt;line-height:1.5;margin:2cm;color:#111}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:4px 8px}th{background:#eee}
blockquote{border-left:3px solid #aaa;margin-left:0;padding-left:12px;color:#444}a{color:#1a5fb4}</style></head><body>${editorJsonHtml}</body></html>`;
}
