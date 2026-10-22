import { closestCenter, DndContext, KeyboardSensor, PointerSensor, type UniqueIdentifier, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import i18n from "i18next";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CornerDownRight,
  Globe,
  GripVertical,
  Monitor,
  MoreHorizontal,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { type Condition, type Device, devices, type RedirectRule } from "@/lib/api";
import { cn, countryName, monoInput, stepBadge } from "@/lib/utils";

export type RuleItem = { id: string; rule: RedirectRule };
export type RuleEditing = { id: string; check: boolean } | null;

let lastId = 0;
export const toItems = (rules: RedirectRule[]): RuleItem[] => rules.map((rule) => ({ id: `rule-${++lastId}`, rule }));

const cleanCountries = (countries: string[]) => countries.map((code) => code.trim()).filter(Boolean);

export const toRules = (items: RuleItem[]): RedirectRule[] =>
  items.map(({ rule }) => ({
    ...rule,
    conditions: rule.conditions.map((condition) =>
      condition.type === "country" ? { ...condition, countries: cleanCountries(condition.countries) } : condition,
    ),
  }));

const validCountries = (countries: string[]) => {
  const codes = cleanCountries(countries);
  return codes.length > 0 && codes.every((code) => /^[a-z]{2}$/i.test(code));
};

export function ruleError({ id, rule }: RuleItem, index: number) {
  const position = index + 1;
  const country = rule.conditions.findIndex((condition) => condition.type === "country" && !validCountries(condition.countries));
  if (country >= 0) return { field: `${id}-condition-${country}`, message: i18n.t("rules.invalidCountries", { position }) };
  if (!URL.canParse(rule.target) || !/^https?:\/\//i.test(rule.target)) {
    return { field: `${id}-target`, message: i18n.t("rules.invalidTarget", { position }) };
  }
}

const word = "text-small text-muted-foreground";

let countryList: Intl.ListFormat | undefined;
function conditionText(condition: Condition) {
  if (condition.type === "device") return i18n.t("rules.deviceIs", { device: i18n.t(`devices.${condition.device}`) });
  countryList ??= new Intl.ListFormat(i18n.language, { type: "disjunction" });
  const codes = cleanCountries(condition.countries).map((code) => code.toUpperCase());
  const names = codes.map((code) => (/^[A-Z]{2}$/.test(code) ? countryName(code) : code));
  return i18n.t("rules.countryIs", { countries: countryList.format(names) });
}

function RuleSentence({ rule }: { rule: RedirectRule }) {
  const { t } = useTranslation();
  return (
    <>
      <span className={word}>{t("rules.if")}</span>
      {rule.conditions.map((condition, index) => {
        const Icon = condition.type === "country" ? Globe : condition.device === "desktop" ? Monitor : Smartphone;
        return (
          <Fragment key={index}>
            {index > 0 && <span className={word}>{t("rules.and")}</span>}
            <span className="inline-flex min-h-[26px] items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-small font-medium text-secondary-foreground">
              <Icon className="size-3.5" aria-hidden="true" />
              {conditionText(condition)}
            </span>
          </Fragment>
        );
      })}
    </>
  );
}

function RuleTarget({ target }: { target: string }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex min-w-0 flex-[1_1_220px] items-center gap-2">
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{t("rules.goTo")}</span>
      <span translate="no" className="min-w-0 truncate font-mono text-mono">
        {target || <span className="font-sans text-muted-foreground">{t("rules.noTarget")}</span>}
      </span>
    </span>
  );
}

type RowProps = {
  item: RuleItem;
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
};

function RuleRow({
  item,
  index,
  count,
  onMove,
  onRemove,
  onEdit,
  focusActions,
}: RowProps & { onEdit: () => void; focusActions: object | null }) {
  const { t } = useTranslation();
  const actions = useRef<HTMLButtonElement>(null);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    attributes: { roleDescription: t("rules.sortable") },
  });
  useEffect(() => {
    if (focusActions) actions.current?.focus();
  }, [focusActions]);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "grid grid-cols-[24px_24px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-card p-3",
        isDragging && "relative z-10 shadow-lg",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t("rules.move", { position: index + 1 })}
        className="-my-1 grid h-8 w-6 cursor-grab touch-none place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <span aria-hidden="true" className={stepBadge}>
        {index + 1}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <RuleSentence rule={item.rule} />
        <RuleTarget target={item.rule.target} />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={actions} type="button" variant="ghost" size="icon-sm" aria-label={t("rules.actions", { position: index + 1 })}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="shadow-lg">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil aria-hidden="true" />
            {t("rules.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(index - 1)}>
            <ArrowUp aria-hidden="true" />
            {t("rules.moveUp")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(index + 1)}>
            <ArrowDown aria-hidden="true" />
            {t("rules.moveDown")}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>
            <Trash2 aria-hidden="true" />
            {t("rules.remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function RuleEditor({
  item,
  index,
  count,
  onMove,
  onRemove,
  onChange,
  onDone,
  editing,
}: RowProps & { onChange: (rule: RedirectRule) => void; onDone: () => void; editing: NonNullable<RuleEditing> }) {
  const { t } = useTranslation();
  const { rule } = item;
  const error = editing.check ? ruleError(item, index) : undefined;
  const invalid = (field: string) => (error?.field === field ? { "aria-invalid": true, "aria-describedby": `${item.id}-error` } : {});
  const focusError = useEffectEvent((current: NonNullable<RuleEditing>) => {
    const field = current.check && ruleError(item, index)?.field;
    if (field) document.getElementById(field)?.focus();
  });
  useEffect(() => focusError(editing), [editing]);
  const setConditions = (conditions: Condition[]) => onChange({ ...rule, conditions });
  const replace = (at: number, condition: Condition) =>
    setConditions(rule.conditions.map((old, index) => (index === at ? condition : old)));

  return (
    <li className="flex flex-col gap-4 rounded-lg border border-input bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden="true" className={stepBadge}>
          {index + 1}
        </span>
        <h3 className="text-label font-semibold">{t("rules.editTitle", { position: index + 1 })}</h3>
        <span className={cn(word, "ml-auto")}>{t("rules.allMustMatch")}</span>
      </div>
      {rule.conditions.map((condition, at) => (
        <div key={at} className="flex flex-wrap items-center gap-2">
          <span className={cn(word, "w-8")}>{at === 0 ? t("rules.if") : t("rules.and")}</span>
          <NativeSelect
            autoFocus={at === 0}
            aria-label={t("rules.condition", { n: at + 1 })}
            value={condition.type}
            onChange={(event) =>
              replace(at, event.target.value === "device" ? { type: "device", device: "ios" } : { type: "country", countries: [] })
            }
          >
            <NativeSelectOption value="device">{t("rules.device")}</NativeSelectOption>
            <NativeSelectOption value="country">{t("rules.country")}</NativeSelectOption>
          </NativeSelect>
          <span className={word}>{t("rules.is")}</span>
          {condition.type === "device" ? (
            <NativeSelect
              aria-label={t("rules.conditionValue", { n: at + 1 })}
              value={condition.device}
              onChange={(event) => replace(at, { type: "device", device: event.target.value as Device })}
              className="min-w-[200px]"
            >
              {devices.map((device) => (
                <NativeSelectOption key={device} value={device}>
                  {t(`devices.${device}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <Input
              id={`${item.id}-condition-${at}`}
              aria-label={t("rules.conditionValue", { n: at + 1 })}
              title={t("rules.countriesHint")}
              placeholder={t("examples.countries")}
              value={condition.countries.join(",")}
              onChange={(event) => replace(at, { type: "country", countries: event.target.value.split(",") })}
              {...invalid(`${item.id}-condition-${at}`)}
              {...monoInput}
              className={cn(monoInput.className, "w-[200px]")}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("rules.removeCondition", { n: at + 1 })}
            disabled={rule.conditions.length === 1}
            onClick={() => setConditions(rule.conditions.filter((_, index) => index !== at))}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={rule.conditions.length >= 10}
          onClick={() => setConditions([...rule.conditions, { type: "device", device: "mobile" }])}
        >
          <Plus aria-hidden="true" />
          {t("rules.addCondition")}
        </Button>
      </div>
      <Field>
        <FieldLabel htmlFor={`${item.id}-target`}>{t("rules.target")}</FieldLabel>
        <Input
          id={`${item.id}-target`}
          type="url"
          placeholder={t("examples.countryTarget")}
          value={rule.target}
          onChange={(event) => onChange({ ...rule, target: event.target.value })}
          {...invalid(`${item.id}-target`)}
          {...monoInput}
        />
      </Field>
      {error && <FieldError id={`${item.id}-error`}>{error.message}</FieldError>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          {t("rules.done")}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => onMove(index - 1)}>
          {t("rules.moveUp")}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
          {t("rules.moveDown")}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="ml-auto text-destructive" onClick={onRemove}>
          {t("rules.remove")}
        </Button>
      </div>
    </li>
  );
}

export function RedirectRules({
  items,
  onChange,
  editing,
  onEdit,
  defaultTarget,
}: {
  items: RuleItem[];
  onChange: (items: RuleItem[]) => void;
  editing: RuleEditing;
  onEdit: (editing: RuleEditing) => void;
  defaultTarget: string;
}) {
  const { t } = useTranslation();
  const [returnFocus, setReturnFocus] = useState<{ id: string } | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const position = (id: UniqueIdentifier) => items.findIndex((item) => item.id === id) + 1;
  const move = (from: number, to: number) => onChange(arrayMove(items, from, to));

  function add() {
    const [item] = toItems([{ conditions: [{ type: "device", device: "ios" }], target: "" }]);
    onChange([...items, item]);
    onEdit({ id: item.id, check: false });
  }

  function remove(index: number) {
    const rest = items.filter((_, at) => at !== index);
    onChange(rest);
    setReturnFocus({ id: rest[Math.min(index, rest.length - 1)]?.id ?? "add" });
  }

  useEffect(() => {
    if (returnFocus?.id === "add") addButton.current?.focus();
  }, [returnFocus]);

  return (
    <div className="flex flex-col gap-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (over && active.id !== over.id) move(position(active.id) - 1, position(over.id) - 1);
        }}
        accessibility={{
          screenReaderInstructions: { draggable: t("rules.dragInstructions") },
          announcements: {
            onDragStart: ({ active }) => t("rules.pickedUp", { position: position(active.id) }),
            onDragOver: ({ over }) => (over ? t("rules.over", { position: position(over.id) }) : undefined),
            onDragEnd: ({ over }) => (over ? t("rules.dropped", { position: position(over.id) }) : undefined),
            onDragCancel: ({ active }) => t("rules.cancelled", { position: position(active.id) }),
          },
        }}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          <ol aria-label={t("rules.listLabel")} className="flex flex-col gap-2 empty:hidden">
            {items.map((item, index) => {
              const props = {
                item,
                index,
                count: items.length,
                onMove: (to: number) => move(index, to),
                onRemove: () => remove(index),
              };
              return item.id === editing?.id ? (
                <RuleEditor
                  key={item.id}
                  {...props}
                  editing={editing}
                  onChange={(rule) => onChange(items.map((old) => (old.id === item.id ? { ...old, rule } : old)))}
                  onDone={() => {
                    if (ruleError(item, index)) return onEdit({ id: item.id, check: true });
                    onEdit(null);
                    setReturnFocus({ id: item.id });
                  }}
                />
              ) : (
                <RuleRow
                  key={item.id}
                  {...props}
                  onEdit={() => onEdit({ id: item.id, check: false })}
                  focusActions={returnFocus?.id === item.id ? returnFocus : null}
                />
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>
      <Button ref={addButton} type="button" variant="secondary" className="self-start" onClick={add}>
        <Plus aria-hidden="true" />
        {t("rules.add")}
      </Button>
      <div className="grid grid-cols-[24px_24px_minmax(0,1fr)] items-center gap-3 rounded-lg border border-dashed bg-muted p-3">
        <span />
        <CornerDownRight className="size-4 justify-self-center text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={word}>{t("rules.otherwise")}</span>
          <RuleTarget target={defaultTarget} />
        </div>
      </div>
    </div>
  );
}
