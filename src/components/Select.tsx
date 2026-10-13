import * as Dropdown from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Выберите…",
  disabled,
  id,
  className = "",
  "aria-label": label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label": string;
}) {
  const empty = "__aurum_any__";
  return (
    <Dropdown.Root
      value={value || empty}
      onValueChange={(v) => onValueChange(v === empty ? "" : v)}
      disabled={disabled}
    >
      <Dropdown.Trigger
        id={id}
        aria-label={label}
        className={`select-trigger ${className}`}
      >
        <Dropdown.Value placeholder={placeholder} />
        <Dropdown.Icon className="select-chevron">
          <ChevronDown size={17} />
        </Dropdown.Icon>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="select-menu"
          position="popper"
          sideOffset={7}
          collisionPadding={12}
          onEscapeKeyDown={(e) => e.stopPropagation()}
        >
          <Dropdown.ScrollUpButton className="select-scroll">
            <ChevronUp size={16} />
          </Dropdown.ScrollUpButton>
          <Dropdown.Viewport className="select-viewport">
            {options.map((option) => (
              <Dropdown.Item
                className="select-option"
                key={option.value}
                value={option.value || empty}
                disabled={option.disabled}
              >
                <Dropdown.ItemText>{option.label}</Dropdown.ItemText>
                <Dropdown.ItemIndicator className="select-check">
                  <Check size={17} />
                </Dropdown.ItemIndicator>
              </Dropdown.Item>
            ))}
          </Dropdown.Viewport>
          <Dropdown.ScrollDownButton className="select-scroll">
            <ChevronDown size={16} />
          </Dropdown.ScrollDownButton>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
