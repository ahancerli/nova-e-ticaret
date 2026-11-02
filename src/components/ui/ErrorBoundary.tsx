"use client";

import { Component, type ReactNode } from "react";
import { reportClientError } from "@/lib/error-reporting";

interface Props {
  /** Name in error reports, e.g. "home.section:hero". */
  name: string;
  /** What to render instead of the crashed subtree; `reset` re-mounts it. */
  fallback?: (reset: () => void) => ReactNode;
  children: ReactNode;
}

/**
 * Widget-level error boundary: a crash inside one widget (a home section, the command palette…) is reported
 * and contained, instead of taking the whole page down to the route's error.tsx.
 */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    reportClientError(error, { kind: "boundary", boundary: this.props.name });
  }

  private reset = () => this.setState({ failed: false });

  render() {
    if (this.state.failed) return this.props.fallback ? this.props.fallback(this.reset) : null;
    return this.props.children;
  }
}
