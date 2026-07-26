import { buildModal } from '../core/modal';
import { CommandIndex, type CommandDefinition } from './command-index';

export function openCommandPalette(documentRef: Document, commands: readonly CommandDefinition[], onSelect: (id: string) => void): HTMLElement {
  const index = new CommandIndex();
  commands.forEach((command) => index.register(command));
  const modal = buildModal('aamp-command-palette', 'Command Palette', '<div class="aamp-command-palette-content"></div>', { document: documentRef, width: '680px' });
  const container = modal.querySelector('.aamp-command-palette-content');
  if (!container) throw new Error('Command palette modal did not render.');

  const input = documentRef.createElement('input');
  input.type = 'search';
  input.placeholder = 'Search commands';
  input.autofocus = true;
  input.className = 'aamp-command-search';
  const results = documentRef.createElement('div');
  results.className = 'aamp-command-results';
  container.append(input, results);

  const render = (): void => {
    results.replaceChildren();
    index.search(input.value).forEach((command) => {
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'aamp-command-result';
      button.textContent = `${command.title} — ${command.description}`;
      button.addEventListener('click', () => {
        index.recordUse(command.id);
        modal.remove();
        onSelect(command.id);
      });
      results.append(button);
    });
  };
  input.addEventListener('input', render);
  render();
  input.focus();
  return modal;
}
