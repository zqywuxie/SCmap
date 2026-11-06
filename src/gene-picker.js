// Search and selection share one keyboard-accessible combobox.
export class GenePicker {
  constructor(container, onSelect) {
    this.container = container;
    this.input = container.querySelector('input');
    this.list = container.querySelector('[role="listbox"]');
    this.toggle = container.querySelector('.picker-toggle');
    this.clear = container.querySelector('.picker-clear');
    this.status = container.querySelector('.picker-status');
    this.onSelect = onSelect;
    this.options = [];
    this.visible = [];
    this.selected = null;
    this.query = '';
    this.active = -1;
    this.opened = false;
    this.input.addEventListener('focus', () => {
      this.query = '';
      this.open();
      this.input.select();
    });
    this.input.addEventListener('input', () => {
      this.query = this.input.value.trim().toUpperCase();
      this.open();
    });
    this.input.addEventListener('click', () => {
      if (!this.opened) {
        this.query = '';
        this.open();
        this.input.select();
      }
    });
    this.input.addEventListener('keydown', event => this.keydown(event));
    this.input.addEventListener('blur', () => this.close());
    this.toggle.addEventListener('pointerdown', event => event.preventDefault());
    this.toggle.addEventListener('click', () => {
      if (this.opened) this.close();
      else {
        this.input.focus();
        this.open();
      }
    });
    this.clear.addEventListener('pointerdown', event => event.preventDefault());
    this.clear.addEventListener('click', () => this.select(null));
    this.list.addEventListener('pointerdown', event => event.preventDefault());
    this.list.addEventListener('click', event => {
      const option = event.target.closest('[role="option"]');
      if (option) this.select(Number(option.dataset.code));
    });
    document.addEventListener('pointerdown', event => {
      if (!container.contains(event.target)) this.close();
    });
  }

  update(options, selected, label) {
    this.options = options;
    this.selected = selected;
    this.input.placeholder = `搜索或选择 ${label}`;
    this.clear.hidden = selected === null;
    if (this.opened) this.render();
    else this.restoreLabel();
  }

  restoreLabel() {
    this.input.value = this.options.find(option => option.code === this.selected)?.name || '';
    const selected = this.options.find(option => option.code === this.selected);
    this.status.textContent = selected
      ? `${selected.count.toLocaleString('en-US')} 个携带细胞${selected.count === 0 ? ' · 当前筛选下无携带者' : ''}`
      : `${this.options.filter(option => option.count > 0).length} 个可选基因 · 输入名称筛选`;
  }

  open() {
    if (this.input.disabled) return;
    this.opened = true;
    this.input.setAttribute('aria-expanded', 'true');
    this.list.hidden = false;
    this.render();
  }

  close() {
    this.opened = false;
    this.query = '';
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.restoreLabel();
  }

  render() {
    this.visible = this.options.filter(option => option.count > 0 && option.name.toUpperCase().includes(this.query));
    this.visible.sort((a, b) => {
      const exactA = a.name.toUpperCase() === this.query;
      const exactB = b.name.toUpperCase() === this.query;
      return Number(exactB) - Number(exactA) || b.count - a.count || a.name.localeCompare(b.name);
    });
    this.list.replaceChildren();
    this.visible.forEach(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.id = `${this.list.id}-${option.code}`;
      button.dataset.code = option.code;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(option.code === this.selected));
      const name = document.createElement('span');
      name.textContent = option.name;
      const count = document.createElement('span');
      count.className = 'picker-count';
      count.textContent = `${option.count.toLocaleString('en-US')} 细胞${option.code === this.selected ? ' · 已选' : ''}`;
      button.append(name, count);
      this.list.append(button);
    });
    if (!this.visible.length) {
      const empty = document.createElement('p');
      empty.className = 'picker-empty';
      empty.textContent = '没有匹配的基因，请更换关键词或研究来源';
      this.list.append(empty);
    }
    this.active = -1;
    this.input.removeAttribute('aria-activedescendant');
    this.status.textContent = `匹配 ${this.visible.length} 项 · ↑↓ 移动，Enter 选择，Esc 关闭`;
  }

  select(code) {
    this.selected = code;
    this.close();
    this.onSelect(code);
  }

  keydown(event) {
    if (event.isComposing) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      this.close();
      if (event.key === 'Escape') event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      if (this.opened && this.visible.length) {
        event.preventDefault();
        this.select(this.visible[Math.max(0, this.active)].code);
      }
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    if (!this.opened) this.open();
    if (!this.visible.length) return;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    if (this.active < 0) this.active = step === 1 ? 0 : this.visible.length - 1;
    else this.active = (this.active + step + this.visible.length) % this.visible.length;
    this.list.querySelectorAll('[role="option"]').forEach((option, index) => {
      option.classList.toggle('keyboard-active', index === this.active);
    });
    const option = this.list.children[this.active];
    this.input.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  }
}
