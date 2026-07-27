import { buildModal } from '../core/modal';
import { CommandIndex, type CommandDefinition, type ScopedMemoryGraph } from './command-index';

export function openCommandPalette(
  documentRef: Document,
  commands: readonly CommandDefinition[],
  onSelect: (id: string) => void,
  memoryGraph?: ScopedMemoryGraph,
): HTMLElement {
  const index = new CommandIndex({ memoryGraph });
  commands.forEach((command) => index.register(command));
  const container = documentRef.createElement('div');
  container.className = 'aamp-command-palette-content';
  const modal = buildModal('aamp-command-palette', 'Command Palette', container, { document: documentRef, width: '680px' });

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
    const workspace = index.searchWorkspace(input.value);
    workspace.commands.forEach((command) => {
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
    workspace.memory.forEach((node) => {
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'aamp-command-result';
      button.textContent = `Memory: ${node.label} — ${node.summary}`;
      button.addEventListener('click', () => {
        modal.remove();
        onSelect(`memory:${node.id}`);
      });
      results.append(button);
    });
  };
  input.addEventListener('input', render);
  render();
  input.focus();
  return modal;
}
