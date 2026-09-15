// A wall around a part of the screen that is allowed to fail.
//
// The analysis panel draws whatever came back from a model. It is validated before it gets here,
// but validation is a claim and a crash is a fact: without this, one malformed answer would take
// the grid, the toolbar and the unsaved edits down with it. Everything inside the wall can break;
// nothing outside it notices.
import { Component } from 'react';

export default class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return this.props.fallback
      ? this.props.fallback(this.state.error, () => this.setState({ error: null }))
      : null;
  }
}
