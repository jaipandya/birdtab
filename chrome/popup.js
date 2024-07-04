const countries = [{ "code": "AF", "name": "Afghanistan" }, { "code": "AL", "name": "Albania" }, { "code": "DZ", "name": "Algeria" }, { "code": "AS", "name": "American Samoa" }, { "code": "AD", "name": "Andorra" }, { "code": "AO", "name": "Angola" }, { "code": "AI", "name": "Anguilla" }, { "code": "AQ", "name": "Antarctica" }, { "code": "AG", "name": "Antigua and Barbuda" }, { "code": "AR", "name": "Argentina" }, { "code": "AM", "name": "Armenia" }, { "code": "AW", "name": "Aruba" }, { "code": "AC", "name": "Ashmore and Cartier Islands" }, { "code": "AU", "name": "Australia" }, { "code": "AT", "name": "Austria" }, { "code": "AZ", "name": "Azerbaijan" }, { "code": "BS", "name": "Bahamas" }, { "code": "BH", "name": "Bahrain" }, { "code": "BD", "name": "Bangladesh" }, { "code": "BB", "name": "Barbados" }, { "code": "BY", "name": "Belarus" }, { "code": "BE", "name": "Belgium" }, { "code": "BZ", "name": "Belize" }, { "code": "BJ", "name": "Benin" }, { "code": "BM", "name": "Bermuda" }, { "code": "BT", "name": "Bhutan" }, { "code": "BO", "name": "Bolivia" }, { "code": "BA", "name": "Bosnia and Herzegovina" }, { "code": "BW", "name": "Botswana" }, { "code": "BV", "name": "Bouvet Island" }, { "code": "BR", "name": "Brazil" }, { "code": "IO", "name": "British Indian Ocean Territory" }, { "code": "BN", "name": "Brunei" }, { "code": "BG", "name": "Bulgaria" }, { "code": "BF", "name": "Burkina Faso" }, { "code": "BI", "name": "Burundi" }, { "code": "KH", "name": "Cambodia" }, { "code": "CM", "name": "Cameroon" }, { "code": "CA", "name": "Canada" }, { "code": "CV", "name": "Cape Verde" }, { "code": "BQ", "name": "Caribbean Netherlands" }, { "code": "KY", "name": "Cayman Islands" }, { "code": "CF", "name": "Central African Republic" }, { "code": "TD", "name": "Chad" }, { "code": "CL", "name": "Chile" }, { "code": "CN", "name": "China" }, { "code": "CX", "name": "Christmas Island" }, { "code": "CP", "name": "Clipperton Island" }, { "code": "CC", "name": "Cocos (Keeling) Islands" }, { "code": "CO", "name": "Colombia" }, { "code": "KM", "name": "Comoros" }, { "code": "CG", "name": "Congo" }, { "code": "CK", "name": "Cook Islands" }, { "code": "CS", "name": "Coral Sea Islands" }, { "code": "CR", "name": "Costa Rica" }, { "code": "CI", "name": "Côte d'Ivoire" }, { "code": "HR", "name": "Croatia" }, { "code": "CU", "name": "Cuba" }, { "code": "CW", "name": "Curaçao" }, { "code": "CY", "name": "Cyprus" }, { "code": "CZ", "name": "Czech Republic" }, { "code": "DK", "name": "Denmark" }, { "code": "DJ", "name": "Djibouti" }, { "code": "DM", "name": "Dominica" }, { "code": "DO", "name": "Dominican Republic" }, { "code": "CD", "name": "DR Congo" }, { "code": "EC", "name": "Ecuador" }, { "code": "EG", "name": "Egypt" }, { "code": "SV", "name": "El Salvador" }, { "code": "GQ", "name": "Equatorial Guinea" }, { "code": "ER", "name": "Eritrea" }, { "code": "EE", "name": "Estonia" }, { "code": "SZ", "name": "Eswatini" }, { "code": "ET", "name": "Ethiopia" }, { "code": "FK", "name": "Falkland Islands (Malvinas)" }, { "code": "FO", "name": "Faroe Islands" }, { "code": "FJ", "name": "Fiji" }, { "code": "FI", "name": "Finland" }, { "code": "FR", "name": "France" }, { "code": "GF", "name": "French Guiana" }, { "code": "PF", "name": "French Polynesia" }, { "code": "TF", "name": "French Southern and Antarctic Lands" }, { "code": "GA", "name": "Gabon" }, { "code": "GM", "name": "Gambia" }, { "code": "GE", "name": "Georgia" }, { "code": "DE", "name": "Germany" }, { "code": "GH", "name": "Ghana" }, { "code": "GI", "name": "Gibraltar" }, { "code": "GR", "name": "Greece" }, { "code": "GL", "name": "Greenland" }, { "code": "GD", "name": "Grenada" }, { "code": "GP", "name": "Guadeloupe" }, { "code": "GU", "name": "Guam" }, { "code": "GT", "name": "Guatemala" }, { "code": "GG", "name": "Guernsey" }, { "code": "GN", "name": "Guinea" }, { "code": "GW", "name": "Guinea-Bissau" }, { "code": "GY", "name": "Guyana" }, { "code": "HT", "name": "Haiti" }, { "code": "HM", "name": "Heard Island and McDonald Islands" }, { "code": "XX", "name": "High Seas" }, { "code": "HN", "name": "Honduras" }, { "code": "HK", "name": "Hong Kong" }, { "code": "HU", "name": "Hungary" }, { "code": "IS", "name": "Iceland" }, { "code": "IN", "name": "India" }, { "code": "ID", "name": "Indonesia" }, { "code": "IR", "name": "Iran" }, { "code": "IQ", "name": "Iraq" }, { "code": "IE", "name": "Ireland" }, { "code": "IM", "name": "Isle of Man" }, { "code": "IL", "name": "Israel" }, { "code": "IT", "name": "Italy" }, { "code": "JM", "name": "Jamaica" }, { "code": "JP", "name": "Japan" }, { "code": "JE", "name": "Jersey" }, { "code": "JO", "name": "Jordan" }, { "code": "KZ", "name": "Kazakhstan" }, { "code": "KE", "name": "Kenya" }, { "code": "KI", "name": "Kiribati" }, { "code": "XK", "name": "Kosovo" }, { "code": "KW", "name": "Kuwait" }, { "code": "KG", "name": "Kyrgyzstan" }, { "code": "LA", "name": "Laos" }, { "code": "LV", "name": "Latvia" }, { "code": "LB", "name": "Lebanon" }, { "code": "LS", "name": "Lesotho" }, { "code": "LR", "name": "Liberia" }, { "code": "LY", "name": "Libya" }, { "code": "LI", "name": "Liechtenstein" }, { "code": "LT", "name": "Lithuania" }, { "code": "LU", "name": "Luxembourg" }, { "code": "MO", "name": "Macau" }, { "code": "MG", "name": "Madagascar" }, { "code": "MW", "name": "Malawi" }, { "code": "MY", "name": "Malaysia" }, { "code": "MV", "name": "Maldives" }, { "code": "ML", "name": "Mali" }, { "code": "MT", "name": "Malta" }, { "code": "MH", "name": "Marshall Islands" }, { "code": "MQ", "name": "Martinique" }, { "code": "MR", "name": "Mauritania" }, { "code": "MU", "name": "Mauritius" }, { "code": "YT", "name": "Mayotte" }, { "code": "MX", "name": "Mexico" }, { "code": "FM", "name": "Micronesia" }, { "code": "MD", "name": "Moldova" }, { "code": "MC", "name": "Monaco" }, { "code": "MN", "name": "Mongolia" }, { "code": "ME", "name": "Montenegro" }, { "code": "MS", "name": "Montserrat" }, { "code": "MA", "name": "Morocco" }, { "code": "MZ", "name": "Mozambique" }, { "code": "MM", "name": "Myanmar" }, { "code": "NA", "name": "Namibia" }, { "code": "NR", "name": "Nauru" }, { "code": "NP", "name": "Nepal" }, { "code": "NL", "name": "Netherlands" }, { "code": "NC", "name": "New Caledonia" }, { "code": "NZ", "name": "New Zealand" }, { "code": "NI", "name": "Nicaragua" }, { "code": "NE", "name": "Niger" }, { "code": "NG", "name": "Nigeria" }, { "code": "NU", "name": "Niue" }, { "code": "NF", "name": "Norfolk Island" }, { "code": "MP", "name": "Northern Mariana Islands" }, { "code": "KP", "name": "North Korea" }, { "code": "MK", "name": "North Macedonia" }, { "code": "NO", "name": "Norway" }, { "code": "OM", "name": "Oman" }, { "code": "PK", "name": "Pakistan" }, { "code": "PW", "name": "Palau" }, { "code": "PS", "name": "Palestinian Territory" }, { "code": "PA", "name": "Panama" }, { "code": "PG", "name": "Papua New Guinea" }, { "code": "PY", "name": "Paraguay" }, { "code": "PE", "name": "Peru" }, { "code": "PH", "name": "Philippines" }, { "code": "PN", "name": "Pitcairn Islands" }, { "code": "PL", "name": "Poland" }, { "code": "PT", "name": "Portugal" }, { "code": "PR", "name": "Puerto Rico" }, { "code": "QA", "name": "Qatar" }, { "code": "RE", "name": "Réunion" }, { "code": "RO", "name": "Romania" }, { "code": "RU", "name": "Russia" }, { "code": "RW", "name": "Rwanda" }, { "code": "BL", "name": "Saint Barthélemy" }, { "code": "SH", "name": "Saint Helena, Ascension, and Tristan da Cunha" }, { "code": "KN", "name": "Saint Kitts and Nevis" }, { "code": "LC", "name": "Saint Lucia" }, { "code": "MF", "name": "Saint Martin (French part)" }, { "code": "PM", "name": "Saint Pierre and Miquelon" }, { "code": "VC", "name": "Saint Vincent and the Grenadines" }, { "code": "WS", "name": "Samoa" }, { "code": "SM", "name": "San Marino" }, { "code": "ST", "name": "São Tomé and Príncipe" }, { "code": "SA", "name": "Saudi Arabia" }, { "code": "SN", "name": "Senegal" }, { "code": "RS", "name": "Serbia" }, { "code": "SC", "name": "Seychelles" }, { "code": "SL", "name": "Sierra Leone" }, { "code": "SG", "name": "Singapore" }, { "code": "SX", "name": "Sint Maarten" }, { "code": "SK", "name": "Slovakia" }, { "code": "SI", "name": "Slovenia" }, { "code": "SB", "name": "Solomon Islands" }, { "code": "SO", "name": "Somalia" }, { "code": "ZA", "name": "South Africa" }, { "code": "GS", "name": "South Georgia and South Sandwich Islands" }, { "code": "KR", "name": "South Korea" }, { "code": "SS", "name": "South Sudan" }, { "code": "ES", "name": "Spain" }, { "code": "LK", "name": "Sri Lanka" }, { "code": "SD", "name": "Sudan" }, { "code": "SR", "name": "Suriname" }, { "code": "SJ", "name": "Svalbard" }, { "code": "SE", "name": "Sweden" }, { "code": "CH", "name": "Switzerland" }, { "code": "SY", "name": "Syria" }, { "code": "TW", "name": "Taiwan" }, { "code": "TJ", "name": "Tajikistan" }, { "code": "TZ", "name": "Tanzania" }, { "code": "TH", "name": "Thailand" }, { "code": "TL", "name": "Timor-Leste" }, { "code": "TG", "name": "Togo" }, { "code": "TK", "name": "Tokelau" }, { "code": "TO", "name": "Tonga" }, { "code": "TT", "name": "Trinidad and Tobago" }, { "code": "TN", "name": "Tunisia" }, { "code": "TR", "name": "Türkiye" }, { "code": "TM", "name": "Turkmenistan" }, { "code": "TC", "name": "Turks and Caicos Islands" }, { "code": "TV", "name": "Tuvalu" }, { "code": "UG", "name": "Uganda" }, { "code": "UA", "name": "Ukraine" }, { "code": "AE", "name": "United Arab Emirates" }, { "code": "GB", "name": "United Kingdom" }, { "code": "US", "name": "United States" }, { "code": "UM", "name": "United States Minor Outlying Islands" }, { "code": "UY", "name": "Uruguay" }, { "code": "UZ", "name": "Uzbekistan" }, { "code": "VU", "name": "Vanuatu" }, { "code": "VA", "name": "Vatican City (Holy See)" }, { "code": "VE", "name": "Venezuela" }, { "code": "VN", "name": "Vietnam" }, { "code": "VG", "name": "Virgin Islands (British)" }, { "code": "VI", "name": "Virgin Islands (U.S.)" }, { "code": "WF", "name": "Wallis and Futuna" }, { "code": "EH", "name": "Western Sahara" }, { "code": "YE", "name": "Yemen" }, { "code": "ZM", "name": "Zambia" }, { "code": "ZW", "name": "Zimbabwe" }];

document.addEventListener('DOMContentLoaded', function () {
  const regionSelect = document.getElementById('region');
  const imageSourceSelect = document.getElementById('image-source');
  const autoPlayCheckbox = document.getElementById('auto-play');
  const saveButton = document.getElementById('save-button');
  const deleteCacheButton = document.getElementById('delete-cache-button');
  const statusElement = document.getElementById('status');

  // Populate the region select
  countries.forEach(country => {
    const option = document.createElement('option');
    option.value = country.code;
    option.textContent = country.name;
    regionSelect.appendChild(option);
  });

  // Load current settings
  chrome.storage.sync.get(['region', 'imageSource', 'autoPlay'], function (result) {
    regionSelect.value = result.region || 'US';
    imageSourceSelect.value = result.imageSource || 'macaulay';
    autoPlayCheckbox.checked = result.autoPlay || false;
  });

  // Save settings
  saveButton.addEventListener('click', function () {
    const settings = {
      region: regionSelect.value,
      imageSource: imageSourceSelect.value,
      autoPlay: autoPlayCheckbox.checked
    };
    chrome.storage.sync.set(settings, function () {
      statusElement.textContent = 'Settings saved!';
      chrome.runtime.sendMessage({ action: 'settingsUpdated' });
      setTimeout(() => {
        statusElement.textContent = '';
      }, 1500);
    });
  });

  // Delete cache
  deleteCacheButton.addEventListener('click', function () {
    chrome.storage.local.remove(['cachedBirdInfo', 'cacheDate'], function () {
      statusElement.textContent = 'Cache deleted!';
      chrome.runtime.sendMessage({ action: 'cacheDeleted' });
      setTimeout(() => {
        statusElement.textContent = '';
      }, 1500);
    });
  });
});