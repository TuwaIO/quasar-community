import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CheckboxField } from '@/components/ui/CheckboxField';

// The checkbox of the dashboard forms (data processing, sign-up, data export): a drawn box over a native checkbox, in
// the style of "Remember this wallet" of Nova Connect. Keyboards and screen readers use the native control.
describe('CheckboxField', () => {
  it('is a native checkbox named by its label that reports the new value', () => {
    const onChange = vi.fn();
    render(
      <CheckboxField checked={false} onChange={onChange}>
        I accept the addendum
      </CheckboxField>,
    );

    const box = screen.getByRole('checkbox', { name: 'I accept the addendum' });
    expect(box).not.toBeChecked();

    fireEvent.click(screen.getByText('I accept the addendum'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('draws the ticked state', () => {
    const { container } = render(
      <CheckboxField checked onChange={() => {}}>
        Ticked
      </CheckboxField>,
    );

    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(container.querySelector('[data-state="checked"]')).not.toBeNull();
  });

  it('cannot be changed while disabled', () => {
    const onChange = vi.fn();
    render(
      <CheckboxField checked={false} onChange={onChange} disabled>
        Locked
      </CheckboxField>,
    );

    const box = screen.getByRole('checkbox', { name: 'Locked' });
    expect(box).toBeDisabled();
    fireEvent.click(screen.getByText('Locked'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('describes the box with the description', () => {
    render(
      <CheckboxField checked={false} onChange={() => {}} description="Kept for 3 years">
        Record
      </CheckboxField>,
    );

    expect(screen.getByRole('checkbox', { name: 'Record' })).toHaveAccessibleDescription('Kept for 3 years');
  });
});
