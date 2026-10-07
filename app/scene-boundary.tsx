'use client';
import { Component, type ReactNode } from 'react';

/**
 * Around a lazily loaded 3D scene. Its chunk can fail to arrive (a flaky
 * connection, or a tab opened before a deploy replaced the file), and the
 * rejection is thrown to the nearest error boundary: without one, the
 * framework swaps the whole page for its error screen. This one renders
 * nothing and reports the scene unavailable, so the page keeps its static
 * fallback. `lazy()` keeps the rejection, so there is no retry to offer.
 */
export default class SceneBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
