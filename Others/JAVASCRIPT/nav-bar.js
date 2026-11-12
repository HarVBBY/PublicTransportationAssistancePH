window.addEventListener("scroll", function() {
    var navbar = document.querySelector("nav.navbar"); // Target your navbar element
    if (window.scrollY > 150) { // Adjust this value as needed
        navbar.classList.add("navbar-scrolled");
    } else {
        navbar.classList.remove("navbar-scrolled");
    }
});


// Toggle chatbox visibility
function toggleChat() {
    const chatbox = document.getElementById('chatbox');
    chatbox.style.display = chatbox.style.display === 'none' || chatbox.style.display === '' ? 'flex' : 'none';
  }
  // Toggle FAQ answer visibility
  function toggleFaq(faqItem) {
  const answer = faqItem.nextElementSibling;
  const icon = faqItem.querySelector('.icon');
    if (answer.style.display === 'none' || answer.style.display === '') {
      answer.style.display = 'block'; // Show the answer
      icon.textContent = '−'; // Change icon to minus
    } else {
      answer.style.display = 'none'; // Hide the answer
      icon.textContent = '+'; // Change icon to plus
    }
  }