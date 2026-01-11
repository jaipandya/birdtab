/**
 * Generic Options Menu Component
 * A reusable dropdown menu for various contexts (clock, etc.)
 */

import { log } from './logger.js';

/**
 * Create an options menu instance
 * @param {Object} config - Configuration object
 * @param {HTMLElement} config.triggerElement - Element that triggers the menu
 * @param {HTMLElement} config.anchorElement - Element to anchor the menu position to
 * @param {Array} config.options - Array of option configurations
 * @param {string} config.menuId - Unique ID for the menu
 * @param {string} [config.position='right'] - Menu position relative to anchor ('right', 'left', 'bottom')
 * @returns {Object} Menu controller object
 */
export function createOptionsMenu(config) {
  const { triggerElement, anchorElement, options: staticOptions, getOptions, menuId, position = 'right' } = config;
  
  let menuElement = null;
  let isOpen = false;
  let currentOptions = null;
  
  /**
   * Create the menu DOM element
   */
  function createMenuElement() {
    // Remove existing menu if any
    const existing = document.getElementById(menuId);
    if (existing) existing.remove();
    
    // Get fresh options (supports both static options and factory function)
    currentOptions = getOptions ? getOptions() : staticOptions;
    
    const menu = document.createElement('div');
    menu.id = menuId;
    menu.className = 'options-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-hidden', 'true');
    
    const menuContent = document.createElement('div');
    menuContent.className = 'options-menu-content';
    
    currentOptions.forEach((option, index) => {
      if (option.type === 'divider') {
        const divider = document.createElement('div');
        divider.className = 'options-menu-divider';
        menuContent.appendChild(divider);
        return;
      }
      
      const item = document.createElement('div');
      item.className = 'options-menu-item';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('tabindex', '0');
      
      if (option.type === 'toggle') {
        // Toggle option with label and switch
        const label = document.createElement('span');
        label.className = 'options-menu-label';
        label.textContent = option.label;
        
        const toggleWrapper = document.createElement('div');
        toggleWrapper.className = 'options-menu-toggle';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = option.checked || false;
        checkbox.id = `${menuId}-option-${index}`;
        
        const slider = document.createElement('span');
        slider.className = 'options-menu-slider';
        
        toggleWrapper.appendChild(checkbox);
        toggleWrapper.appendChild(slider);
        
        item.appendChild(label);
        item.appendChild(toggleWrapper);
        
        // Single unified click handler for the entire item row
        const handleToggle = (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          // Toggle the checkbox
          checkbox.checked = !checkbox.checked;
          log(`Option toggled: ${option.label} = ${checkbox.checked}`);
          
          if (option.onChange) {
            option.onChange(checkbox.checked);
          }
        };
        
        // Bind to item row
        item.addEventListener('click', handleToggle);
        
        // Prevent the default checkbox behavior since we handle it manually
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
          // Let the item handler do the work - we revert this click
          e.preventDefault();
        });
        
        // Store reference for updating
        option._checkbox = checkbox;
      } else if (option.type === 'button') {
        // Simple button option
        const label = document.createElement('span');
        label.className = 'options-menu-label';
        label.textContent = option.label;
        item.appendChild(label);
        
        item.addEventListener('click', () => {
          if (option.onClick) {
            option.onClick();
          }
          close();
        });
      }
      
      menuContent.appendChild(item);
    });
    
    menu.appendChild(menuContent);
    document.body.appendChild(menu);
    
    return menu;
  }
  
  /**
   * Position the menu relative to anchor
   */
  function positionMenu() {
    if (!menuElement || !anchorElement) return;
    
    const anchorRect = anchorElement.getBoundingClientRect();
    const menuRect = menuElement.getBoundingClientRect();
    
    let top, left;
    
    if (position === 'right') {
      top = anchorRect.top + (anchorRect.height / 2) - (menuRect.height / 2);
      left = anchorRect.right + 10;
    } else if (position === 'left') {
      top = anchorRect.top + (anchorRect.height / 2) - (menuRect.height / 2);
      left = anchorRect.left - menuRect.width - 10;
    } else if (position === 'bottom') {
      top = anchorRect.bottom + 10;
      left = anchorRect.left + (anchorRect.width / 2) - (menuRect.width / 2);
    }
    
    // Ensure menu stays within viewport
    const padding = 10;
    if (left + menuRect.width > window.innerWidth - padding) {
      left = window.innerWidth - menuRect.width - padding;
    }
    if (left < padding) {
      left = padding;
    }
    if (top + menuRect.height > window.innerHeight - padding) {
      top = window.innerHeight - menuRect.height - padding;
    }
    if (top < padding) {
      top = padding;
    }
    
    menuElement.style.top = `${top}px`;
    menuElement.style.left = `${left}px`;
  }
  
  /**
   * Open the menu
   */
  function open() {
    if (isOpen) return;
    
    menuElement = createMenuElement();
    
    // Position after a frame to ensure dimensions are calculated
    requestAnimationFrame(() => {
      positionMenu();
      menuElement.classList.add('options-menu-visible');
      menuElement.setAttribute('aria-hidden', 'false');
    });
    
    isOpen = true;
    
    // Close when clicking outside
    setTimeout(() => {
      document.addEventListener('click', handleOutsideClick);
      document.addEventListener('keydown', handleKeydown);
    }, 0);
    
    log(`Options menu ${menuId} opened`);
  }
  
  /**
   * Close the menu
   */
  function close() {
    if (!isOpen || !menuElement) return;
    
    menuElement.classList.remove('options-menu-visible');
    menuElement.classList.add('options-menu-closing');
    
    setTimeout(() => {
      if (menuElement && menuElement.parentNode) {
        menuElement.remove();
      }
      menuElement = null;
    }, 150);
    
    isOpen = false;
    
    document.removeEventListener('click', handleOutsideClick);
    document.removeEventListener('keydown', handleKeydown);
    
    log(`Options menu ${menuId} closed`);
  }
  
  /**
   * Toggle menu open/close
   */
  function toggle() {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }
  
  /**
   * Handle clicks outside the menu
   */
  function handleOutsideClick(e) {
    // Don't close if clicking inside the menu
    if (menuElement && menuElement.contains(e.target)) {
      return;
    }
    // Don't close if clicking the trigger
    if (triggerElement && triggerElement.contains(e.target)) {
      return;
    }
    close();
  }
  
  /**
   * Handle keyboard events
   */
  function handleKeydown(e) {
    if (e.key === 'Escape') {
      close();
    }
  }
  
  /**
   * Update an option's checked state
   */
  function updateOption(index, checked) {
    const option = currentOptions ? currentOptions[index] : null;
    if (option && option._checkbox) {
      option._checkbox.checked = checked;
    }
  }
  
  /**
   * Handle trigger click - stored as reference for cleanup
   */
  function handleTriggerClick(e) {
    e.stopPropagation();
    toggle();
  }
  
  /**
   * Destroy the menu and clean up
   */
  function destroy() {
    close();
    if (triggerElement) {
      triggerElement.removeEventListener('click', handleTriggerClick);
    }
  }
  
  // Bind trigger click
  if (triggerElement) {
    triggerElement.addEventListener('click', handleTriggerClick);
  }
  
  return {
    open,
    close,
    toggle,
    updateOption,
    destroy,
    get isOpen() { return isOpen; }
  };
}
