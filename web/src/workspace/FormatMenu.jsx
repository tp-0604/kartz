/**
 * Marking up a board: fill, text colour, weight, alignment.
 *
 * The same set a spreadsheet puts on its first toolbar row, and the same behaviour — it applies
 * to whatever is selected, a toggle inverts what the selection already has, and clearing is one
 * button rather than setting everything back to a default one at a time.
 *
 * The colours are swatches rather than a picker. A picker would let anyone choose #fefefe on
 * white, or a fill that vanishes the moment the theme flips; these nine were checked against
 * both surfaces and each one is a name the theme resolves.
 */
import Dropdown from '../components/shared/Dropdown.jsx';
import { FILLS, FILL_NAMES, INKS, INK_NAMES } from '../data/format.js';

const swatchStyle = (pair, dark) => ({ background: pair[dark ? 1 : 0] });

export default function FormatMenu({ current, onFormat, onClear, disabled, dark, cells }) {
  const on = key => !!(current && current[key]);
  const label = cells > 1 ? `${cells} cells` : 'cell';

  return (
    <>
      <button className={'btn btn--sm btn--icon' + (on('b') ? ' is-on' : '')} disabled={disabled}
              title="Bold (Ctrl+B)" onClick={() => onFormat({ b: !on('b') })}
              style={{ fontWeight: 800 }}>B</button>
      <button className={'btn btn--sm btn--icon' + (on('i') ? ' is-on' : '')} disabled={disabled}
              title="Italic (Ctrl+I)" onClick={() => onFormat({ i: !on('i') })}
              style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>I</button>
      <button className={'btn btn--sm btn--icon' + (on('u') ? ' is-on' : '')} disabled={disabled}
              title="Underline (Ctrl+U)" onClick={() => onFormat({ u: !on('u') })}
              style={{ textDecoration: 'underline' }}>U</button>

      <Dropdown className="btn btn--sm" width={224} disabled={disabled}
                title={`Fill the ${label}`}
                label={<span className="fmtbtn"><i className="fmtbtn__chip"
                  style={current && current.bg ? swatchStyle(FILLS[current.bg], dark) : undefined} />Fill</span>}>
        {close => (
          <>
            <div className="menu__head">Fill</div>
            <div className="swatches">
              <button type="button" className={'swatch swatch--none' + (!(current && current.bg) ? ' is-on' : '')}
                      title="No fill" onClick={() => { onFormat({ bg: null }); close(); }} />
              {FILL_NAMES.map(name => (
                <button key={name} type="button" title={name}
                        className={'swatch' + (current && current.bg === name ? ' is-on' : '')}
                        style={swatchStyle(FILLS[name], dark)}
                        onClick={() => { onFormat({ bg: name }); close(); }} />
              ))}
            </div>
            <div className="menu__head">Text</div>
            <div className="swatches">
              <button type="button" className={'swatch swatch--none' + (!(current && current.fg) ? ' is-on' : '')}
                      title="Default" onClick={() => { onFormat({ fg: null }); close(); }} />
              {INK_NAMES.map(name => (
                <button key={name} type="button" title={name}
                        className={'swatch swatch--ink' + (current && current.fg === name ? ' is-on' : '')}
                        style={{ color: INKS[name][dark ? 1 : 0] }}
                        onClick={() => { onFormat({ fg: name }); close(); }}>A</button>
              ))}
            </div>
            <hr className="menu__sep" />
            <div className="menu__head">Align</div>
            <div className="btnrow" style={{ padding: '0 8px 8px' }}>
              {[['left', '⯇'], ['center', '≡'], ['right', '⯈']].map(([a, glyph]) => (
                <button key={a} type="button"
                        className={'btn btn--sm' + (current && current.a === a ? ' is-on' : '')}
                        onClick={() => onFormat({ a: current && current.a === a ? null : a })}>{glyph}</button>
              ))}
              <span className="spacer" />
              <button type="button" className="btn btn--sm" onClick={() => { onClear(); close(); }}>
                Clear formatting
              </button>
            </div>
            <div className="menu__head" style={{ textTransform: 'none', letterSpacing: 0,
                                                 fontFamily: 'var(--sans)' }}>
              A mark belongs to its row, so it follows the player through a sort, a filter and a
              rank correction.
            </div>
          </>
        )}
      </Dropdown>
    </>
  );
}
