'use client';

import type { ReactSelectOption } from '@payloadcms/ui';
import { FieldDescription, FieldError, FieldLabel, ReactSelect, useField } from '@payloadcms/ui';
import type { SelectFieldClientComponent } from 'payload';

/**
 * Renders `Apps.kind` matching Payload's native Select design system,
 * in which the Payments option is present for roadmap visibility but disabled/not selectable.
 *
 * Why not simply omit the option: Payments is a shipped-but-dormant product
 * milestone (open-source-plans/03-billing-vs-payments.md). Dropping it from
 * `options` also drops it from the generated Payload types and narrows the
 * column, which is what left `payload-types.ts` disagreeing with `Apps.ts`
 * once types were regenerated - the API route validating `kind` still
 * accepted 'payments' while the generated type no longer admitted it.
 * Keeping the option declared keeps the schema honest; disabling the entry
 * is what actually blocks the choice.
 *
 * Defence in depth: the `validate` on the field rejects 'payments' for any
 * caller that bypasses this component (REST, direct Local API).
 */
export const AppKindField: SelectFieldClientComponent = ({ field, path }) => {
  const { value, setValue, showError, errorMessage } = useField<string>({ path });

  const rawOptions = (field.options ?? []).map((option) =>
    typeof option === 'string' ? { label: option, value: option } : option,
  );

  const options: ReactSelectOption[] = rawOptions.map((opt) => ({
    label: typeof opt.label === 'string' ? opt.label : opt.value,
    value: opt.value,
  }));

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className="field-type select" id={`field-${path.replace(/\./g, '__')}`}>
      <FieldLabel label={field.label} path={path} required={field.required} />

      <div className="field-type__wrap">
        <FieldError path={path} showError={showError} />

        <ReactSelect
          disabled={Boolean(field.admin?.readOnly)}
          isClearable={false}
          {...({
            isOptionDisabled: (option: ReactSelectOption) => option.value === 'payments',
          } as Record<string, unknown>)}
          onChange={(opt) => {
            if (!opt || Array.isArray(opt)) return;
            if (opt.value !== 'payments') {
              setValue(opt.value as string);
            }
          }}
          options={options}
          showError={showError}
          value={selectedOption}
        />
      </div>

      {field.admin?.description ? <FieldDescription description={field.admin.description} path={path} /> : null}
      {showError && errorMessage ? (
        <div className="field-error" style={{ marginTop: '4px' }}>
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
};
