


// PHONE ANIMATION SCROLL ----------------------------------------------------
document.addEventListener("DOMContentLoaded", function () {
    const fadeElements = document.querySelectorAll('.fade-in');

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target); // Unobserve once it becomes visible
            }
        });
    }, { threshold: 0.1 });

    fadeElements.forEach(element => {
        observer.observe(element);
    });
});

// BUTTON LAUNCH -------------------------------------------------------------
const button = document.querySelector(".button");
      
button.addEventListener("click", (e) => {
  e.preventDefault;
  
  button.classList.add("animate");
    setTimeout(() => {
      button.classList.remove("animate");
    }, 600);
});
function redirectWithDelay() {
  // Set timeout for the desired delay (e.g., 2000 milliseconds = 2 seconds)
  setTimeout(function() {
      window.location.href = 'PUBTASYSTEM.html';
  }, 1000);
}



// SWIPER ---------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
    new Swiper('.card-wrapper', {
      loop: true,
      spaceBetween: 30,
  
      // Pagination
      pagination: {
        el: '.swiper-pagination',
        clickable: true,
        dynamicBullets: true
      },
  
      // Navigation arrows
      navigation: {
        nextEl: '.swiper-button-next',
        prevEl: '.swiper-button-prev',
      },
      breakpoints: {
        0:{
          slidesPerView: 1
        },
        768: {
          slidesPerView: 2
        },
        1024:{
          slidesPerView: 2
        },
      }
    });
  });
  


$('a[href^="#"]').on('click', function(event) {
    event.preventDefault();
    const target = this.hash;
    $('html, body').animate({
        scrollTop: $(target).offset().top
    }, 800, 'swing');
});