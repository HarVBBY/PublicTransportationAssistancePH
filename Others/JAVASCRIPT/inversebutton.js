const Slocation = document.getElementById("startinput");
const Elocation = document.getElementById("endinput");
const inverse_button = document.getElementById("inverse_location");

inverse_button.addEventListener("click", switch_values);

function switch_values() {
    // Check if both inputs have values
    if (Slocation.value.trim() === "" || Elocation.value.trim() === "") {
        return; 
    }

    // Swap the values
    const temp = Slocation.value;
    Slocation.value = Elocation.value;
    Elocation.value = temp;


}