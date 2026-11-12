const openModalButtons = document.querySelectorAll('[data-modal-target]')
const closeModalButtons = document.querySelectorAll('[data-close-button]')
const overlay = document.getElementById('tutorial-overlay')

openModalButtons.forEach(button => {
    button.addEventListener('click', () => {
        const tutorial = document.querySelector(button.dataset.modalTarget)
        openModal(tutorial)
    })
})

closeModalButtons.forEach(button => {
    button.addEventListener('click', () => {
        const tutorial = button.closest('.tutorial')
        closeModal(tutorial)
    })
})

function openModal(tutorial) {
    if (tutorial == null) return
    tutorial.classList.add('active')
    overlay.classList.add('active')
}

function closeModal(tutorial) {
    if (tutorial == null) return
    tutorial.classList.remove('active')
    overlay.classList.remove('active')
}
