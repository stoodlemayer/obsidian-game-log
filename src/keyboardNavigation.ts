export interface KeyboardNavigableItem {
    element: HTMLElement;
    onSelect: () => void;
}
export class KeyboardNavigationHelper {
    private items: KeyboardNavigableItem[] = [];
    private selectedIndex = -1;
    private container: HTMLElement;

    constructor(container: HTMLElement) {
        this.container = container;
        this.setupEventListeners();
    }

    addItem(element: HTMLElement, onSelect: () => void) {
        this.items.push({ element, onSelect });
        element.setAttribute('data-keyboard-index', (this.items.length - 1).toString());
    }

    // Add this new public method
    selectFirst() {
        if (this.items.length > 0) {
            this.selectedIndex = -1; // Start from -1 so moveSelection(1) goes to 0
            this.moveSelection(1); // This will select the first item (index 0)
        }
    }

    private setupEventListeners() {
        this.container.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.moveSelection(1);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.moveSelection(-1);
                    break;
                case 'Enter':
                    e.preventDefault();
                    this.selectCurrent();
                    break;
                case 'Escape':
                    e.preventDefault();
                    this.clearSelection();
                    break;
            }
        });
    }

    private moveSelection(direction: number) {
        // Clear previous selection
        if (this.selectedIndex >= 0 && this.items[this.selectedIndex]) {
            this.items[this.selectedIndex].element.classList.remove('keyboard-selected');
            // Also reset background color to ensure clean state
            this.items[this.selectedIndex].element.style.backgroundColor = '';
            this.items[this.selectedIndex].element.style.color = '';
        }

        // Calculate new index
        this.selectedIndex += direction;
        if (this.selectedIndex >= this.items.length) {
            this.selectedIndex = 0;
        } else if (this.selectedIndex < 0) {
            this.selectedIndex = this.items.length - 1;
        }

        // Apply new selection
        if (this.items[this.selectedIndex]) {
            const selectedElement = this.items[this.selectedIndex].element;
            selectedElement.classList.add('keyboard-selected');
            
            // Force the highlighting with inline styles as backup
            selectedElement.style.backgroundColor = 'var(--interactive-accent)';
            selectedElement.style.color = 'var(--text-on-accent)';
            
            // Scroll into view
            selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    private selectCurrent() {
        if (this.selectedIndex >= 0 && this.items[this.selectedIndex]) {
            this.items[this.selectedIndex].onSelect();
        }
    }

    clearSelection() {
        if (this.selectedIndex >= 0 && this.items[this.selectedIndex]) {
            this.items[this.selectedIndex].element.classList.remove('keyboard-selected');
            // Clear inline styles too
            this.items[this.selectedIndex].element.style.backgroundColor = '';
            this.items[this.selectedIndex].element.style.color = '';
        }
        this.selectedIndex = -1;
    }

    destroy() {
        // Clear all selections before destroying
        this.clearSelection();
        this.items = [];
        this.selectedIndex = -1;
    }
}