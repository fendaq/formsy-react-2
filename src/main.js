var React = global.React || require('react');

import PropTypes from 'prop-types';
import formDataToObject from 'form-data-to-object';
import validationRules from './validationRules.js';
import utils from './utils.js';
import Mixin from './Mixin.js';
import HOC from './HOC.js';
import Decorator from './Decorator.js';

let options = {};
let emptyArray = [];
let Formsy = {}

Formsy.HOC = HOC;
Formsy.Decorator = Decorator;
Formsy.Mixin = Mixin;

Formsy.defaults = function (passedOptions) {
  options = passedOptions;
};

Formsy.addValidationRule = function (name, func, force = false) {
  if (!force && Object.keys(validationRules).indexOf(name) !== -1) {
    console.error('A Validation Rule with that name already exists: ' + name);
    return;
  }
  validationRules[name] = func;
};

class Form extends React.Component {
  displayName = 'Formsy'

  static childContextTypes = {
    formsy: PropTypes.object
  }

  state = {
    isValid: true,
    isSubmitting: false,
    canChange: false
  }

  static defaultProps = {
    onSuccess: () => {},
    onError: () => {},
    onSubmit: () => {},
    onValidSubmit: () => {},
    onInvalidSubmit: () => {},
    onValid: () => {},
    onInvalid: () => {},
    onChange: () => {},
    validationErrors: null,
    preventExternalInvalidation: false
  }


  getChildContext() {
    return {
      formsy: {
        attachToForm: this.attachToForm,
        detachFromForm: this.detachFromForm,
        validate: this.validate,
        isFormDisabled: this.isFormDisabled,
        isValidValue: (component, value) => {
          return this.runValidation(component, value).isValid;
        }
      }
    }
  }

  // Add a map to store the inputs of the form, a model to store
  // the values of the form and register child inputs
  componentWillMount() {
    this.inputs = [];
  }

  componentDidMount() {
    this.validateForm();
  }

  componentWillUpdate() {
    // Keep a reference to input names before form updates,
    // to check if inputs has changed after render
    this.prevInputNames = this.inputs.map(component => component.props.name);
  }

  componentDidUpdate() {
    if (this.props.validationErrors && typeof this.props.validationErrors === 'object' && Object.keys(this.props.validationErrors).length > 0) {
      this.setInputValidationErrors(this.props.validationErrors);
    }

    var newInputNames = this.inputs.map(component => component.props.name);
    if (utils.arraysDiffer(this.prevInputNames, newInputNames)) {
      this.validateForm();
    }
  }

  // Allow resetting to specified data
  reset = (data) => {
    this.setFormPristine(true);
    this.resetModel(data);
  }

  // Update model, submit to url prop and send the model
  submit = (event) => {
    event && event.preventDefault();

    // Trigger form as not pristine.
    // If any inputs have not been touched yet this will make them dirty
    // so validation becomes visible (if based on isPristine)
    this.setFormPristine(false);
    var model = this.getModel();
    this.props.onSubmit(model, this.resetModel.bind(this), this.updateInputsWithError.bind(this));
    this.state.isValid ?
      this.props.onValidSubmit(model, this.resetModel.bind(this), this.updateInputsWithError.bind(this)) :
      this.props.onInvalidSubmit(model, this.resetModel.bind(this), this.updateInputsWithError.bind(this));
  }

  mapModel(model) {
    if (this.props.mapping) {
      return this.props.mapping(model)
    } else {
      return formDataToObject.toObj(Object.keys(model).reduce((mappedModel, key) => {

        var keyArray = key.split('.');
        var base = mappedModel;
        while (keyArray.length) {
          var currentKey = keyArray.shift();
          base = (base[currentKey] = keyArray.length ? base[currentKey] || {} : model[key]);
        }

        return mappedModel;

      }, {}));
    }
  }

  getModel() {
    var currentValues = this.getCurrentValues();
    return this.mapModel(currentValues);
  }

  // Reset each key in the model to the original / initial / specified value
  resetModel (data) {
    this.inputs.forEach(component => {
      var name = component.props.name;
      if (data && data.hasOwnProperty(name)) {
        component.setValue(data[name]);
      } else {
        component.resetValue();
      }
    });
    this.validateForm();
  }

  setInputValidationErrors(errors) {
    this.inputs.forEach(component => {
      var name = component.props.name;
      var args = [{
        _isValid: !(name in errors),
        _validationError: typeof errors[name] === 'string' ? [errors[name]] : errors[name]
      }];
      component.setState.apply(component, args);
    });
  }

  // Checks if the values have changed from their initial value
  isChanged() {
    return !utils.isSame(this.getPristineValues(), this.getCurrentValues());
  }

   getPristineValues() {
    return this.inputs.reduce((data, component) => {
      var name = component.props.name;
      data[name] = component.props.value;
      return data;
    }, {});
  }

  // Go through errors from server and grab the components
  // stored in the inputs map. Change their state to invalid
  // and set the serverError message
  updateInputsWithError(errors) {

    Object.keys(errors).forEach((name, index) => {
      var component = utils.find(this.inputs, component => component.props.name === name);
      if (!component) {
        throw new Error('You are trying to update an input that does not exist. ' +
          'Verify errors object with input names. ' + JSON.stringify(errors));
      }
      var args = [{
        _isValid: this.props.preventExternalInvalidation || false,
        _externalError: typeof errors[name] === 'string' ? [errors[name]] : errors[name]
      }];
      component.setState.apply(component, args);
    }, this);
  }

  isFormDisabled = () => {
    return this.props.disabled || false;
  }

  getCurrentValues() {
    return this.inputs.reduce((data, component) => {
      var name = component.props.name;
      data[name] = component.state._value;
      return data;
    }, {});
  }

  setFormPristine(isPristine) {
    this.setState({
      _formSubmitted: !isPristine
    });

    // Iterate through each component and set it as pristine
    // or "dirty".
    this.inputs.forEach((component, index) => {
      component.setState({
        _formSubmitted: !isPristine,
        _isPristine: isPristine
      });
    });
  }

  // Use the binded values and the actual input value to
  // validate the input and set its state. Then check the
  // state of the form itself
  validate = (component) => {
    // Trigger onChange
    if (this.state.canChange) {
      this.props.onChange(this.getCurrentValues(), this.isChanged());
    }

    var validation = this.runValidation(component);
    // Run through the validations, split them up and call
    // the validator IF there is a value or it is required
    component.setState({
      _isValid: validation.isValid,
      _isRequired: validation.isRequired,
      _validationError: validation.error,
      _externalError: null
    }, this.validateForm);
  }

  // Checks validation on current value or a passed value
  runValidation(component, value) {
    var currentValues = this.getCurrentValues();
    var validationErrors = component.props.validationErrors;
    var validationError = component.props.validationError;
    value = arguments.length === 2 ? value : component.state._value;

    var validationResults = this.runRules(value, currentValues, component._validations);
    var requiredResults = this.runRules(value, currentValues, component._requiredValidations);

    // the component defines an explicit validate function
    if (typeof component.validate === "function") {
      validationResults.failed = component.validate() ? [] : [{ method: 'failed' }];
    }

    var isRequired = Object.keys(component._requiredValidations).length ? !!requiredResults.success.length : false;
    var isValid = !validationResults.failed.length && !(this.props.validationErrors && this.props.validationErrors[component.props.name]);

    return {
      isRequired: isRequired,
      isValid: isRequired ? false : isValid,
      error: (function () {

        if (isValid && !isRequired) {
          return emptyArray;
        }

        if (validationResults.errors.length) {
          return validationResults.errors;
        }

        if (this.props.validationErrors && this.props.validationErrors[component.props.name]) {
          return typeof this.props.validationErrors[component.props.name] === 'string' ? [this.props.validationErrors[component.props.name]] : this.props.validationErrors[component.props.name];
        }

        if (isRequired) {
          var error = validationErrors[requiredResults.success[0]];
          return error ? [error] : null;
        }

        return validationResults.failed.map(function(failed) {
          var errorMessage = validationErrors && validationErrors[failed.method] ? validationErrors[failed.method] : validationError;

          failed.args && [].concat(failed.args).forEach((arg, i) => {
            errorMessage = errorMessage.replace(new RegExp('\\{' + i + '\\}', 'g'), arg);
          });

          return errorMessage;
        }).filter(function(x, pos, arr) {
          // Remove duplicates
          return arr.indexOf(x) === pos;
        });

      }.call(this))
    };
  }

  runRules(value, currentValues, validations) {
    var results = {
      errors: [],
      failed: [],
      success: []
    };
    if (Object.keys(validations).length) {
      Object.keys(validations).forEach(function (validationMethod) {

        if (validationRules[validationMethod] && typeof validations[validationMethod] === 'function') {
          throw new Error('Formsy does not allow you to override default validations: ' + validationMethod);
        }

        if (!validationRules[validationMethod] && typeof validations[validationMethod] !== 'function') {
          throw new Error('Formsy does not have the validation rule: ' + validationMethod);
        }

        if (typeof validations[validationMethod] === 'function') {
          var validation = validations[validationMethod](currentValues, value);
          if (typeof validation === 'string') {
            results.errors.push(validation);
            results.failed.push({ method: validationMethod });
          } else if (!validation) {
            results.failed.push({ method: validationMethod });
          }
          return;

        } else if (typeof validations[validationMethod] !== 'function') {
          var validation = validationRules[validationMethod](currentValues, value, validations[validationMethod]);
          if (typeof validation === 'string') {
            results.errors.push(validation);
            results.failed.push({ method: validationMethod, args: validations[validationMethod] });
          } else if (!validation) {
            results.failed.push({ method: validationMethod, args: validations[validationMethod] });
          } else {
            results.success.push(validationMethod);
          }
          return;

        }

        return results.success.push(validationMethod);

      });
    }

    return results;
  }

  // Validate the form by going through all child input components
  // and check their state
  validateForm = () => {
    // We need a callback as we are validating all inputs again. This will
    // run when the last component has set its state
    var onValidationComplete = function () {
      var allIsValid = this.inputs.every(component => {
        return component.state._isValid;
      });

      this.setState({
        isValid: allIsValid
      });

      if (allIsValid) {
        this.props.onValid();
      } else {
        this.props.onInvalid();
      }

      // Tell the form that it can start to trigger change events
      this.setState({
        canChange: true
      });

    }.bind(this);

    // Run validation again in case affected by other inputs. The
    // last component validated will run the onValidationComplete callback
    this.inputs.forEach((component, index) => {
      var validation = this.runValidation(component);
      if (validation.isValid && component.state._externalError) {
        validation.isValid = false;
      }
      component.setState({
        _isValid: validation.isValid,
        _isRequired: validation.isRequired,
        _validationError: validation.error,
        _externalError: !validation.isValid && component.state._externalError ? component.state._externalError : null
      });
    });

    onValidationComplete();

    // If there are no inputs, set state where form is ready to trigger
    // change event. New inputs might be added later
    if (!this.inputs.length) {
      this.setState({
        canChange: true
      });
    }
  }

  // Method put on each input component to register
  // itself to the form
  attachToForm = (component) => {
    if (this.inputs.indexOf(component) === -1) {
      this.inputs.push(component);
    }

    this.validate(component);
  }

  // Method put on each input component to unregister
  // itself from the form
  detachFromForm = (component) => {
    var componentPos = this.inputs.indexOf(component);

    if (componentPos !== -1) {
      this.inputs = this.inputs.slice(0, componentPos)
        .concat(this.inputs.slice(componentPos + 1));
    }

    this.validateForm();
  }

  render() {
    var {
      mapping,
      validationErrors,
      onSubmit,
      onValid,
      onValidSubmit,
      onInvalid,
      onInvalidSubmit,
      onChange,
      reset,
      preventExternalInvalidation,
      onSuccess,
      onError,
      ...nonFormsyProps
    } = this.props;

    return (
      <form {...nonFormsyProps} onSubmit={this.submit}>
        {this.props.children}
      </form>
    );
  }
};

Formsy.Form = Form;

if (!global.exports && !global.module && (!global.define || !global.define.amd)) {
  global.Formsy = Formsy;
}

module.exports = Formsy;
