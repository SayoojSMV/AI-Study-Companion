import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Surface } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected rendering issue occurred.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught workspace error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh bg-background text-foreground flex items-center justify-center p-6">
          <Surface className="max-w-md w-full p-6 space-y-4">
            <h1 className="text-xl font-medium font-editorial">
              Study desk interrupted
            </h1>
            <p role="alert" className="text-sm text-muted leading-relaxed">
              {this.state.errorMessage}
            </p>
            <div className="pt-2">
              <Button
                tone="primary"
                onClick={() => window.location.reload()}
              >
                Reload workspace
              </Button>
            </div>
          </Surface>
        </div>
      );
    }

    return this.props.children;
  }
}
