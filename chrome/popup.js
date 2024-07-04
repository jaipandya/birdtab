document.addEventListener('DOMContentLoaded', function() {
  const imageSourceSelect = document.getElementById('image-source');
  const autoPlayCheckbox = document.getElementById('auto-play');
  const saveButton = document.getElementById('save-button');
  const statusElement = document.getElementById('status');

  console.log("saveButton", saveButton);
  console.log("imageSourceSelect", imageSourceSelect);
  console.log("autoPlayCheckbox", autoPlayCheckbox);
  console.log("statusElement", statusElement);

  // Load current settings
  chrome.storage.sync.get(['imageSource', 'autoPlay'], function(result) {
    imageSourceSelect.value = result.imageSource || 'macaulay';
    autoPlayCheckbox.checked = result.autoPlay || false;
  });

  // Save settings
  saveButton.addEventListener('click', function() {
    const imageSource = imageSourceSelect.value;
    const autoPlay = autoPlayCheckbox.checked;
    chrome.storage.sync.set({imageSource: imageSource, autoPlay: autoPlay}, function() {
      console.log("Settings saved");
      statusElement.textContent = 'Settings saved!';
      
      // Trigger a refresh of the new tab page
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0].url === 'chrome://newtab/') {
          chrome.tabs.reload(tabs[0].id);
        }
      });

      setTimeout(() => {
        statusElement.textContent = '';
      }, 1500);
    });
  });
});