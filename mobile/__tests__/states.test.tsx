import NetInfo from '@react-native-community/netinfo';
import { fireEvent, render, screen, act } from '@testing-library/react-native';
import React from 'react';
import { ApiError } from '../src/api/client';
import { EmptyState, ErrorState, Loading, OfflineBanner, QueryBoundary } from '../src/components/ui';

describe('loading / empty / error / offline states', () => {
  it('ErrorState shows the network message and calls retry', async () => {
    const retry = jest.fn();
    await render(<ErrorState error={new ApiError(0, 'NETWORK', 'x')} onRetry={retry} />);
    expect(screen.getByText(/No connection to the server/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });

  it('ErrorState shows a generic message for non-network errors', async () => {
    await render(<ErrorState error={new ApiError(500, 'INTERNAL', 'x')} />);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('EmptyState renders title and body', async () => {
    await render(<EmptyState body="No conversations yet." />);
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    expect(screen.getByText('No conversations yet.')).toBeTruthy();
  });

  it('QueryBoundary: loading → error (with retry) → data', async () => {
    const refetch = jest.fn();
    const base = { error: null, refetch } as const;
    const { rerender } = await render(<QueryBoundary q={{ ...base, isLoading: true, isError: false }}>{() => null}</QueryBoundary>);
    expect(screen.getByLabelText('Loading…')).toBeTruthy();
    await rerender(<QueryBoundary q={{ ...base, isLoading: false, isError: true, error: new ApiError(0, 'NETWORK', '') }}>{() => null}</QueryBoundary>);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
    await rerender(<QueryBoundary<string[]> q={{ ...base, isLoading: false, isError: false, data: ['a', 'b'] }}>{(d) => <>{d.map((x) => <React.Fragment key={x}>{null}</React.Fragment>)}<Loading /></>}</QueryBoundary>);
    expect(screen.getByLabelText('Loading…')).toBeTruthy();
  });

  it('OfflineBanner appears only when offline', async () => {
    let listener: (s: { isConnected: boolean; isInternetReachable: boolean }) => void = () => {};
    (NetInfo.addEventListener as jest.Mock).mockImplementation((cb) => { listener = cb; return () => {}; });
    await render(<OfflineBanner />);
    expect(screen.queryByText(/You are offline/)).toBeNull();
    await act(async () => listener({ isConnected: false, isInternetReachable: false }));
    expect(screen.getByText(/You are offline/)).toBeTruthy();
    await act(async () => listener({ isConnected: true, isInternetReachable: true }));
    expect(screen.queryByText(/You are offline/)).toBeNull();
  });
});
