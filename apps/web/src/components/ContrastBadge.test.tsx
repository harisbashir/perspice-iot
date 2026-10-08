import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContrastBadge } from './ContrastBadge';

describe('ContrastBadge', () => {
  it('fails yellow against white text', () => {
    render(<ContrastBadge color="#FFFF00" />);
    expect(screen.getByText(/Fails/)).toBeInTheDocument();
  });

  it('passes the default teal', () => {
    render(<ContrastBadge color="#0F766E" />);
    expect(screen.getByText(/Passes/)).toBeInTheDocument();
  });
});
