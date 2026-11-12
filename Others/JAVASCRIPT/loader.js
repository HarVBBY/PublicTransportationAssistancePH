// LOADING SCREEN ------------------------------------------------------------
window.addEventListener("load", () => {
    const loader = document.querySelector(".loader");
    const main_content = document.querySelector(".main-content-pubta-launcher");
  
    // Hide the loader
    loader.classList.add("loader--hidden");

    // Show the main content after the loader is hidden
    loader.addEventListener("transitionend", () => {
        document.body.removeChild(loader);
        main_content.classList.add("main_content--visible"); // Show main content
    });
});