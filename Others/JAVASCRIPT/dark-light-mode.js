let darkmode = localStorage.getItem('darkmode');
const themeSwitchButtons = document.querySelectorAll('.theme-switch'); // Use class instead of ID

const enableDarkmode = () => {
  document.body.classList.add('darkmode');
  localStorage.setItem('darkmode', 'active');
  updateThemeSwitchIcons(true); // Update icons to show moon
};

const disableDarkmode = () => {
  document.body.classList.remove('darkmode');
  localStorage.setItem('darkmode', null);
  updateThemeSwitchIcons(false); // Update icons to show sun
};

// Function to update icons based on theme state
const updateThemeSwitchIcons = (isDarkMode) => {
  themeSwitchButtons.forEach(button => {
    const sunIcon = button.querySelector('svg:first-child'); // Sun icon
    const moonIcon = button.querySelector('svg:last-child'); // Moon icon
    
    if (isDarkMode) {
      sunIcon.style.display = 'none'; // Hide sun icon
      moonIcon.style.display = 'block'; // Show moon icon
    } else {
      sunIcon.style.display = 'block'; // Show sun icon
      moonIcon.style.display = 'none'; // Hide moon icon
    }
  });
};

// Check if dark mode was previously enabled
if (darkmode === "active") {
  enableDarkmode(); // Enable dark mode and update icons
}

// Add event listener to all theme switch buttons
themeSwitchButtons.forEach(button => {
  button.addEventListener("click", () => {
    darkmode = localStorage.getItem('darkmode');
    darkmode !== "active" ? enableDarkmode() : disableDarkmode();
  });
});

